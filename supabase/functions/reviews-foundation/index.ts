import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import {
  mapReviewItemRowToPreview,
  mapReviewLocationRow,
  mapReviewSyncRunRow,
} from '../_shared/reviews.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let workspaceId: string;
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await validateAuth(
      req,
      typeof body.workspace_id === 'string' ? body.workspace_id : undefined,
    );
    workspaceId = auth.workspaceId;
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }

    console.error('[reviews-foundation] auth failed:', error);
    return jsonResponse({ error: 'Authentication failed' }, 401);
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const [
      { data: locations, error: locationsError },
      { data: items, error: itemsError },
      { data: syncRuns, error: syncRunsError },
    ] = await Promise.all([
      supabase
        .from('review_locations')
        .select(
          'id, provider_location_ref, provider_account_ref, place_id, name, address, is_primary, avg_rating_cached, review_count_cached, last_synced_at, sync_status, last_error',
        )
        .eq('workspace_id', workspaceId)
        .eq('provider', 'google')
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true }),
      supabase
        .from('review_items')
        .select(
          'id, location_id, author_name, rating, body, status, reply_status, created_at_provider, owner_name, draft_reply, draft_updated_at, published_reply, published_reply_at, published_by_name',
        )
        .eq('workspace_id', workspaceId)
        .eq('provider', 'google')
        .order('created_at_provider', { ascending: false }),
      supabase
        .from('review_sync_runs')
        .select('id, status, started_at, completed_at, detail, error_message')
        .eq('workspace_id', workspaceId)
        .eq('provider', 'google')
        .order('started_at', { ascending: false })
        .limit(10),
    ]);

    if (locationsError) throw locationsError;
    if (itemsError) throw itemsError;
    if (syncRunsError) throw syncRunsError;

    const mappedLocations = (locations ?? []).map((row) => mapReviewLocationRow(row));
    const primaryLocation =
      mappedLocations.find((location) => location.is_primary) ?? mappedLocations[0] ?? null;
    const locationNameById = new Map(
      mappedLocations.map((location) => [location.id, location.name ?? 'Primary Google location']),
    );
    const scopedItems =
      primaryLocation == null
        ? (items ?? [])
        : (items ?? []).filter((row) => String(row.location_id) === primaryLocation.id);
    const mappedReviews = scopedItems.map((row) =>
      mapReviewItemRowToPreview(
        row,
        locationNameById.get(String(row.location_id)) ?? 'Primary Google location',
      ),
    );
    const mappedSyncRuns = (syncRuns ?? []).map((row) => mapReviewSyncRunRow(row));

    return jsonResponse({
      workspace_id: workspaceId,
      locations: mappedLocations,
      reviews: mappedReviews,
      syncRuns: mappedSyncRuns,
    });
  } catch (error) {
    console.error('[reviews-foundation] failed:', error);
    return jsonResponse({ error: 'Failed to load reviews foundation' }, 500);
  }
});
