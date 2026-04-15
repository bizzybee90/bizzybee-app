import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import { HttpError } from '../_shared/pipeline.ts';
import {
  createPortalSession,
  createStripeAdminClient,
  loadWorkspaceSubscription,
} from '../_shared/stripe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type RequestBody = {
  workspace_id?: string;
  return_url?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    const body = (await req.json()) as RequestBody;
    const workspaceId = body.workspace_id?.trim();
    const returnUrl = body.return_url?.trim();

    if (!workspaceId) throw new HttpError(400, 'workspace_id is required');
    if (!returnUrl) throw new HttpError(400, 'return_url is required');

    try {
      await validateAuth(req, workspaceId);
    } catch (error) {
      if (error instanceof AuthError) return authErrorResponse(error);
      throw error;
    }

    const supabase = createStripeAdminClient();
    const subscription = await loadWorkspaceSubscription(supabase, workspaceId);
    if (!subscription?.stripe_customer_id) {
      throw new HttpError(
        404,
        'This workspace does not have a Stripe customer yet. Complete checkout first.',
      );
    }

    const session = await createPortalSession({
      customerId: subscription.stripe_customer_id,
      returnUrl,
    });

    return jsonResponse(200, {
      ok: true,
      url: session.url,
    });
  } catch (error) {
    console.error('stripe-create-portal-session error', error);
    if (error instanceof HttpError) {
      return jsonResponse(error.status, { ok: false, error: error.message });
    }

    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});
