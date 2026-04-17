/**
 * Curated "nearby towns" discovery for onboarding radius expansion.
 *
 * Why this exists separately from the uk_towns table + expand_search_queries
 * RPC: the uk_towns dataset is unweighted (no population or settlement
 * classification) and returns the N nearest places by haversine — which for
 * Luton+20mi includes wards/suburbs of St Albans (Sopwell, Fleetville,
 * Marshalswick, Bernards Heath, Townsend, Cotonmills…) and Hemel Hempstead
 * (Bennetts End). A window cleaner won't independently rank in those
 * sublocalities — they'll rank for their parent town, which we already
 * query. The result is wasted Places spend and duplicated candidate sets.
 *
 * Flow:
 *   1. Resolve primary town to lat/lng via Places Text Search (the
 *      GOOGLE_MAPS_API_KEY on this project has Places enabled but not
 *      Geocoding — REQUEST_DENIED from geocode/json on 2026-04-17).
 *   2. Query uk_towns for the nearest ~2N candidates within the user's
 *      radius, by haversine. This gives us a pool of place NAMES.
 *   3. For each candidate, call Places Find Place From Text to fetch
 *      its Google `types` array. Filter out any candidate whose types
 *      include any `sublocality*` classification — those are wards /
 *      suburbs of a larger locality. Keep only candidates with a
 *      `locality` type.
 *   4. Return nearest-first, up to `max_towns`.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TEXTSEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const FINDPLACE_URL = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: { primary_town?: string; radius_miles?: number; max_towns?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const primaryTown = body.primary_town?.trim();
  const radiusMiles = Number(body.radius_miles);
  const maxTowns = Math.max(1, Math.min(Number(body.max_towns) || 20, 30));
  if (!primaryTown) return jsonResponse({ error: 'primary_town required' }, 400);
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    return jsonResponse({ error: 'radius_miles must be a positive number' }, 400);
  }

  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')?.trim();
  if (!apiKey) return jsonResponse({ error: 'GOOGLE_MAPS_API_KEY not configured' }, 500);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'Supabase env not configured' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Primary town lat/lng via Places Text Search (Geocoding API isn't
  // enabled on this key). Prefer a result Google tags as locality so we
  // don't centre on a pub/shop named "Luton".
  const primaryLookupUrl = new URL(TEXTSEARCH_URL);
  primaryLookupUrl.searchParams.set('query', `${primaryTown}, UK`);
  primaryLookupUrl.searchParams.set('region', 'uk');
  primaryLookupUrl.searchParams.set('key', apiKey);

  let primaryLat = 0;
  let primaryLng = 0;
  try {
    const resp = await fetch(primaryLookupUrl.toString());
    const data = (await resp.json()) as {
      status?: string;
      results?: Array<{
        geometry?: { location?: { lat: number; lng: number } };
        types?: string[];
      }>;
    };
    if (data.status !== 'OK') {
      return jsonResponse({ error: 'Could not resolve primary town', status: data.status }, 400);
    }
    const localityMatch = (data.results ?? []).find(
      (r) => r.types?.includes('locality') && r.geometry?.location,
    );
    const chosen = localityMatch ?? data.results?.[0];
    if (!chosen?.geometry?.location) {
      return jsonResponse({ error: 'Could not resolve primary town', status: 'NO_GEOMETRY' }, 400);
    }
    primaryLat = chosen.geometry.location.lat;
    primaryLng = chosen.geometry.location.lng;
  } catch (error) {
    console.error('[get-nearby-towns] primary-town lookup error', error);
    return jsonResponse({ error: 'Primary town lookup failed' }, 500);
  }

  // 2. Query uk_towns for candidates inside a bounding box that covers
  // the user's radius, then haversine-filter to true radius. Bounding-box
  // prefilter matches the RPC's algorithm.
  const latDelta = (radiusMiles / 69) * 1.15;
  const lngDelta = (radiusMiles / (Math.cos((primaryLat * Math.PI) / 180) * 69)) * 1.15;
  const { data: ukRows, error: ukError } = await supabase
    .from('uk_towns')
    .select('name, latitude, longitude, canonical_slug')
    .gte('latitude', primaryLat - latDelta)
    .lte('latitude', primaryLat + latDelta)
    .gte('longitude', primaryLng - lngDelta)
    .lte('longitude', primaryLng + lngDelta);
  if (ukError) {
    console.error('[get-nearby-towns] uk_towns query error', ukError);
    return jsonResponse({ error: 'uk_towns query failed' }, 500);
  }

  const primaryLower = primaryTown.toLowerCase();
  const candidatePool = (ukRows ?? [])
    .map((r) => ({
      name: r.name as string,
      canonical_slug: r.canonical_slug as string,
      lat: r.latitude as number,
      lng: r.longitude as number,
      distance_miles: haversineMiles(
        primaryLat,
        primaryLng,
        r.latitude as number,
        r.longitude as number,
      ),
    }))
    .filter((t) => t.distance_miles <= radiusMiles)
    .filter((t) => t.name.toLowerCase() !== primaryLower)
    .sort((a, b) => a.distance_miles - b.distance_miles)
    // Validate up to 2× what we need — roughly half get filtered as
    // sublocalities in dense urban areas (e.g. the St Albans/Hemel
    // Hempstead ring around Luton).
    .slice(0, maxTowns * 2);

  // 3. Validate each candidate via Places Find Place From Text. Returns
  // the place's `types` array, which includes `locality`, `sublocality`,
  // `administrative_area_level_1..5`, `political`, etc. We keep only
  // candidates with a `locality` type and NO `sublocality*` type.
  const validated = await Promise.all(
    candidatePool.map(async (cand) => {
      const u = new URL(FINDPLACE_URL);
      u.searchParams.set('input', `${cand.name}, UK`);
      u.searchParams.set('inputtype', 'textquery');
      u.searchParams.set('fields', 'place_id,types,name,geometry');
      u.searchParams.set('key', apiKey);
      try {
        const resp = await fetch(u.toString());
        const data = (await resp.json()) as {
          status?: string;
          candidates?: Array<{
            place_id?: string;
            types?: string[];
            name?: string;
            geometry?: { location?: { lat: number; lng: number } };
          }>;
        };
        if (data.status !== 'OK') return null;
        const match = data.candidates?.[0];
        if (!match) return null;
        const types = match.types ?? [];
        const isLocality = types.includes('locality');
        const isSublocality = types.some((t) => t.startsWith('sublocality'));
        if (!isLocality || isSublocality) return null;
        return {
          ...cand,
          place_id: match.place_id ?? null,
          types,
        };
      } catch (error) {
        console.warn('[get-nearby-towns] findplace error for', cand.name, error);
        return null;
      }
    }),
  );

  const towns = validated.filter((v): v is NonNullable<typeof v> => v !== null).slice(0, maxTowns);

  return jsonResponse({
    primary: { town: primaryTown, lat: primaryLat, lng: primaryLng },
    towns,
    radius_miles: radiusMiles,
    candidates_considered: candidatePool.length,
    candidates_rejected_as_sublocality: candidatePool.length - towns.length,
  });
});
