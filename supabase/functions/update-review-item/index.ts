import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import { mapReviewItemRowToPreview } from '../_shared/reviews.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedUpdateKeys = {
  status: 'status',
  replyStatus: 'reply_status',
  ownerName: 'owner_name',
  draftReply: 'draft_reply',
  draftUpdatedAt: 'draft_updated_at',
  publishedReply: 'published_reply',
  publishedReplyAt: 'published_reply_at',
  publishedByName: 'published_by_name',
} as const;

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

  try {
    const body = await req.json().catch(() => ({}));
    const reviewId = typeof body.review_id === 'string' ? body.review_id : '';
    const updates = body.updates && typeof body.updates === 'object' ? body.updates : null;

    if (!reviewId || !updates) {
      return jsonResponse({ error: 'review_id and updates are required' }, 400);
    }

    const auth = await validateAuth(
      req,
      typeof body.workspace_id === 'string' ? body.workspace_id : undefined,
    );

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: existingItem, error: existingItemError } = await supabase
      .from('review_items')
      .select('id, location_id, workspace_id')
      .eq('id', reviewId)
      .eq('workspace_id', auth.workspaceId)
      .single();

    if (existingItemError || !existingItem) {
      return jsonResponse({ error: 'Review item not found' }, 404);
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    for (const [inputKey, dbKey] of Object.entries(allowedUpdateKeys)) {
      if (Object.prototype.hasOwnProperty.call(updates, inputKey)) {
        updatePayload[dbKey] = (updates as Record<string, unknown>)[inputKey];
      }
    }

    if (Object.keys(updatePayload).length === 1) {
      return jsonResponse({ error: 'No valid updates supplied' }, 400);
    }

    const { data: updatedItem, error: updatedItemError } = await supabase
      .from('review_items')
      .update(updatePayload)
      .eq('id', reviewId)
      .eq('workspace_id', auth.workspaceId)
      .select(
        'id, location_id, author_name, rating, body, status, reply_status, created_at_provider, owner_name, draft_reply, draft_updated_at, published_reply, published_reply_at, published_by_name',
      )
      .single();

    if (updatedItemError) {
      throw updatedItemError;
    }

    const { data: location, error: locationError } = await supabase
      .from('review_locations')
      .select('name')
      .eq('id', existingItem.location_id)
      .maybeSingle();

    if (locationError) {
      throw locationError;
    }

    return jsonResponse({
      review: mapReviewItemRowToPreview(
        updatedItem,
        (location?.name as string | null) ?? 'Primary Google location',
      ),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }

    console.error('[update-review-item] failed:', error);
    return jsonResponse({ error: 'Failed to update review item' }, 500);
  }
});
