import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import {
  buildGooglePreviewSeed,
  computeLocationMetricsFromSeed,
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

function getReviewConnectionConfig(config: unknown) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return null;
  }

  const record = config as Record<string, unknown>;
  const accountRef =
    typeof record.reviewAccountRef === 'string' ? record.reviewAccountRef.trim() : '';
  const locationRef =
    typeof record.reviewLocationRef === 'string' ? record.reviewLocationRef.trim() : '';
  const placeId = typeof record.placeId === 'string' ? record.placeId.trim() : '';
  const placeLabel =
    typeof record.reviewPlaceLabel === 'string' ? record.reviewPlaceLabel.trim() : '';

  if (!accountRef || !locationRef) {
    return null;
  }

  return { accountRef, locationRef, placeId, placeLabel };
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

    console.error('[sync-google-reviews-preview] auth failed:', error);
    return jsonResponse({ error: 'Authentication failed' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let syncRunId: string | null = null;
  let locationId: string | null = null;

  try {
    const { data: channelRecord, error: channelError } = await supabase
      .from('workspace_channels')
      .select('config')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'google_business')
      .maybeSingle();

    if (channelError) throw channelError;

    const config = getReviewConnectionConfig(channelRecord?.config);
    if (!config) {
      return jsonResponse(
        {
          error:
            'Google review connection is incomplete. Save the Google account and location identifiers first.',
        },
        400,
      );
    }

    const startedAt = new Date().toISOString();
    const locationName = config.placeLabel || 'Primary Google location';

    const { data: syncRun, error: syncRunError } = await supabase
      .from('review_sync_runs')
      .insert({
        workspace_id: workspaceId,
        provider: 'google',
        sync_mode: 'preview_seed',
        status: 'running',
        started_at: startedAt,
        detail: 'Preparing preview review sync for the saved Google Business Profile location.',
        metadata: {
          provider_location_ref: config.locationRef,
          provider_account_ref: config.accountRef,
          place_id: config.placeId || null,
          place_label: config.placeLabel || null,
        },
      })
      .select('id')
      .single();

    if (syncRunError) throw syncRunError;
    syncRunId = syncRun.id as string;

    const { data: location, error: locationError } = await supabase
      .from('review_locations')
      .upsert(
        {
          workspace_id: workspaceId,
          provider: 'google',
          channel: 'google_business',
          provider_account_ref: config.accountRef,
          provider_location_ref: config.locationRef,
          place_id: config.placeId || null,
          name: locationName,
          is_primary: true,
          sync_status: 'syncing',
          last_error: null,
          metadata: {
            source: 'preview_seed',
            review_place_label: config.placeLabel || null,
          },
          updated_at: startedAt,
        },
        { onConflict: 'workspace_id,provider,provider_location_ref' },
      )
      .select(
        'id, provider_location_ref, provider_account_ref, place_id, name, address, is_primary, avg_rating_cached, review_count_cached, last_synced_at, sync_status, last_error',
      )
      .single();

    if (locationError) throw locationError;
    locationId = location.id as string;

    await supabase
      .from('review_locations')
      .update({ is_primary: false, updated_at: startedAt })
      .eq('workspace_id', workspaceId)
      .eq('provider', 'google')
      .neq('id', location.id);

    const seed = buildGooglePreviewSeed(config.locationRef, locationName);
    const { data: existingItems, error: existingItemsError } = await supabase
      .from('review_items')
      .select(
        'id, provider_review_id, status, reply_status, owner_name, draft_reply, draft_updated_at, published_reply, published_reply_at, published_by_name, created_at_provider',
      )
      .eq('workspace_id', workspaceId)
      .eq('provider', 'google')
      .in(
        'provider_review_id',
        seed.map((item) => item.providerReviewId),
      );

    if (existingItemsError) throw existingItemsError;

    const existingByProviderId = new Map(
      (existingItems ?? []).map((item) => [String(item.provider_review_id), item]),
    );

    const reviewItemsPayload = seed.map((item) => {
      const existing = existingByProviderId.get(item.providerReviewId);

      return {
        workspace_id: workspaceId,
        location_id: location.id,
        provider: 'google',
        provider_review_id: item.providerReviewId,
        source_kind: 'preview_seed',
        author_name: item.authorName,
        rating: item.rating,
        body: item.body,
        status: existing?.status ?? item.status,
        reply_status: existing?.reply_status ?? item.replyStatus,
        created_at_provider: existing?.created_at_provider ?? item.createdAt,
        owner_name: existing?.owner_name ?? item.ownerName ?? null,
        draft_reply: existing?.draft_reply ?? item.draftReply ?? null,
        draft_updated_at: existing?.draft_updated_at ?? item.draftUpdatedAt ?? null,
        published_reply: existing?.published_reply ?? item.publishedReply ?? null,
        published_reply_at: existing?.published_reply_at ?? item.publishedReplyAt ?? null,
        published_by_name: existing?.published_by_name ?? item.publishedByName ?? null,
        raw_payload: {
          source: 'preview_seed',
          provider_location_ref: config.locationRef,
        },
        metadata: {
          location_name: locationName,
        },
        updated_at: startedAt,
      };
    });

    const { data: upsertedItems, error: upsertItemsError } = await supabase
      .from('review_items')
      .upsert(reviewItemsPayload, { onConflict: 'workspace_id,provider,provider_review_id' })
      .select(
        'id, location_id, author_name, rating, body, status, reply_status, created_at_provider, owner_name, draft_reply, draft_updated_at, published_reply, published_reply_at, published_by_name',
      );

    if (upsertItemsError) throw upsertItemsError;

    const metrics = computeLocationMetricsFromSeed(seed);
    const completedAt = new Date().toISOString();

    const { data: updatedLocation, error: updatedLocationError } = await supabase
      .from('review_locations')
      .update({
        is_primary: true,
        sync_status: 'ready',
        avg_rating_cached: metrics.avgRating,
        review_count_cached: metrics.count,
        last_synced_at: completedAt,
        last_error: null,
        updated_at: completedAt,
      })
      .eq('id', location.id)
      .select(
        'id, provider_location_ref, provider_account_ref, place_id, name, address, is_primary, avg_rating_cached, review_count_cached, last_synced_at, sync_status, last_error',
      )
      .single();

    if (updatedLocationError) throw updatedLocationError;

    const { data: completedRun, error: completedRunError } = await supabase
      .from('review_sync_runs')
      .update({
        status: 'success',
        completed_at: completedAt,
        items_synced: upsertedItems?.length ?? 0,
        location_id: location.id,
        detail: `Preview sync seeded ${upsertedItems?.length ?? 0} Google review objects for ${locationName}.`,
      })
      .eq('id', syncRunId)
      .select('id, status, started_at, completed_at, detail, error_message')
      .single();

    if (completedRunError) throw completedRunError;

    return jsonResponse({
      workspace_id: workspaceId,
      location: mapReviewLocationRow(updatedLocation),
      reviews: (upsertedItems ?? []).map((item) =>
        mapReviewItemRowToPreview(item, updatedLocation.name ?? locationName),
      ),
      syncRun: mapReviewSyncRunRow(completedRun),
    });
  } catch (error) {
    console.error('[sync-google-reviews-preview] failed:', error);

    if (syncRunId) {
      await supabase
        .from('review_sync_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', syncRunId);
    }

    if (locationId) {
      await supabase
        .from('review_locations')
        .update({
          sync_status: 'failed',
          last_error: error instanceof Error ? error.message : 'Unknown error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', locationId);
    }

    return jsonResponse({ error: 'Failed to seed Google review preview data' }, 500);
  }
});
