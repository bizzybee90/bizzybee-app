import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

/**
 * Lowercase, strip non-alphanumerics, hyphenate spaces, trim edges.
 * Matches the `canonical_slug` column written in the uk_towns seed.
 * "St. Albans" → "st-albans", "Stoke-on-Trent" → "stoke-on-trent".
 */
export function canonicalTownSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const EARTH_RADIUS_MILES = 3959;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Great-circle distance between two lat/lng points in miles.
 * Standard haversine. Stable to ~0.5% across typical UK distances.
 */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return EARTH_RADIUS_MILES * c;
}

export interface NearbyTown {
  name: string;
  miles: number;
}

type UkTownRow = {
  name: string;
  canonical_slug: string;
  latitude: number;
  longitude: number;
};

/**
 * Resolve a user-supplied primary town name → coords, then return the N
 * nearest towns within `radiusMiles`, excluding the primary itself.
 *
 * Slug resolution is exact-only in v1. Fuzzy (prefix / Levenshtein) matching
 * can be layered on by callers if needed — keeping this helper deterministic
 * makes it trivially testable.
 *
 * `radiusMiles <= 0` is a valid "no expansion" signal → returns [].
 *
 * The uk_towns table schema is (id, name, latitude, longitude,
 * canonical_slug, created_at) — the upstream CSV source
 * (joelacus/world-cities GB subset) doesn't carry population/county, so the
 * select list matches the real columns only.
 */
export async function findNearbyTowns(
  supabase: SupabaseClient,
  primaryTownName: string,
  radiusMiles: number,
  maxResults = 6,
): Promise<NearbyTown[]> {
  if (radiusMiles <= 0) return [];

  const slug = canonicalTownSlug(primaryTownName);
  if (!slug) return [];

  const primaryResult = await supabase
    .from('uk_towns')
    .select('name, canonical_slug, latitude, longitude')
    .eq('canonical_slug', slug)
    .maybeSingle();

  if (primaryResult.error) {
    console.warn('[uk-towns] primary lookup failed', {
      slug,
      error: primaryResult.error.message,
    });
    return [];
  }
  if (!primaryResult.data) return [];

  const primaryRow = primaryResult.data as UkTownRow;

  // Rough lat/lng bounding-box pre-filter so we don't pull the whole table.
  // 1° latitude ≈ 69 miles; 1° longitude varies by latitude but is roughly
  // cos(lat) × 69 miles. Add 15% slack for the haversine "corner" error vs box.
  const latDelta = (radiusMiles / 69) * 1.15;
  const lngDelta = (radiusMiles / (Math.cos(primaryRow.latitude * DEG_TO_RAD) * 69)) * 1.15;

  const candidatesResult = await supabase
    .from('uk_towns')
    .select('name, canonical_slug, latitude, longitude')
    .gte('latitude', primaryRow.latitude - latDelta)
    .lte('latitude', primaryRow.latitude + latDelta)
    .gte('longitude', primaryRow.longitude - lngDelta)
    .lte('longitude', primaryRow.longitude + lngDelta);

  if (candidatesResult.error) {
    console.warn('[uk-towns] candidate lookup failed', {
      slug,
      error: candidatesResult.error.message,
    });
    return [];
  }

  const rows = (candidatesResult.data ?? []) as UkTownRow[];
  return rows
    .filter((t) => t.canonical_slug !== primaryRow.canonical_slug)
    .map((t) => ({
      name: t.name,
      miles: haversineMiles(primaryRow.latitude, primaryRow.longitude, t.latitude, t.longitude),
    }))
    .filter((t) => t.miles <= radiusMiles)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, maxResults);
}
