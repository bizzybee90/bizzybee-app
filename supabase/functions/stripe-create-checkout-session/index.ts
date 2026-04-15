import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import { HttpError } from '../_shared/pipeline.ts';
import {
  createCheckoutSession,
  createStripeAdminClient,
  ensureStripeCustomerForWorkspace,
  loadWorkspaceSubscription,
} from '../_shared/stripe.ts';
import {
  isStripeBillingAddonKey,
  isStripeBillingPlanKey,
  type StripeBillingAddonKey,
  type StripeBillingPlanKey,
} from '../_shared/stripeCatalog.ts';

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
  plan_key?: string;
  addon_keys?: string[];
  success_url?: string;
  cancel_url?: string;
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
    const planKey = body.plan_key?.trim();
    const successUrl = body.success_url?.trim();
    const cancelUrl = body.cancel_url?.trim();

    if (!workspaceId) throw new HttpError(400, 'workspace_id is required');
    if (!planKey || !isStripeBillingPlanKey(planKey)) {
      throw new HttpError(400, 'plan_key must be one of connect, starter, growth, pro');
    }
    if (!successUrl || !cancelUrl) {
      throw new HttpError(400, 'success_url and cancel_url are required');
    }

    try {
      await validateAuth(req, workspaceId);
    } catch (error) {
      if (error instanceof AuthError) return authErrorResponse(error);
      throw error;
    }

    const addonKeys = Array.isArray(body.addon_keys)
      ? body.addon_keys.filter((value): value is StripeBillingAddonKey =>
          isStripeBillingAddonKey(value),
        )
      : [];

    const supabase = createStripeAdminClient();
    const existingSubscription = await loadWorkspaceSubscription(supabase, workspaceId);
    if (
      existingSubscription?.stripe_subscription_id &&
      ['trialing', 'active', 'past_due', 'paused'].includes(existingSubscription.status)
    ) {
      throw new HttpError(
        409,
        'This workspace already has a Stripe subscription. Use the billing portal to manage changes.',
      );
    }

    const customerId = await ensureStripeCustomerForWorkspace(supabase, workspaceId);
    const session = await createCheckoutSession({
      customerId,
      workspaceId,
      planKey: planKey as StripeBillingPlanKey,
      addonKeys,
      successUrl,
      cancelUrl,
    });

    return jsonResponse(200, {
      ok: true,
      session_id: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('stripe-create-checkout-session error', error);
    if (error instanceof HttpError) {
      return jsonResponse(error.status, { ok: false, error: error.message });
    }

    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});
