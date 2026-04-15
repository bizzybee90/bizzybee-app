import { HttpError } from '../_shared/pipeline.ts';
import {
  createStripeAdminClient,
  fetchSubscription,
  loadWorkspaceSubscription,
  parseStripeWebhookEvent,
  syncWorkspaceBillingFromSubscription,
  verifyStripeWebhookSignature,
  type StripeEvent,
  type StripeSubscription,
} from '../_shared/stripe.ts';
import { sendWorkspaceLifecycleEmail } from '../_shared/lifecycleEmail.ts';
import {
  deriveBillingNotification,
  type BillingSnapshot,
} from '../_shared/stripeBillingNotifications.ts';
import { isStripeBillingAddonKey, type StripeBillingAddonKey } from '../_shared/stripeCatalog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function loadPreviousBillingSnapshot(
  supabase: ReturnType<typeof createStripeAdminClient>,
  workspaceId: string,
): Promise<BillingSnapshot | null> {
  const subscription = await loadWorkspaceSubscription(supabase, workspaceId);
  if (!subscription) {
    return null;
  }

  const { data: addons, error: addonsError } = await supabase
    .from('workspace_addons')
    .select('addon_key, status')
    .eq('workspace_id', workspaceId)
    .neq('status', 'canceled');

  if (addonsError) {
    throw new HttpError(500, `Failed to load workspace add-ons: ${addonsError.message}`);
  }

  const addonKeys = (addons ?? [])
    .map((row) => row.addon_key)
    .filter((addonKey): addonKey is StripeBillingAddonKey => isStripeBillingAddonKey(addonKey));

  return {
    planKey: subscription.plan_key as BillingSnapshot['planKey'],
    addonKeys,
    status: subscription.status,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodEnd: subscription.current_period_end,
  };
}

function resolveWorkspaceIdFromSubscription(subscription: StripeSubscription): string | null {
  return subscription.metadata?.workspace_id?.trim() || null;
}

async function sendBillingNotification(params: {
  supabase: ReturnType<typeof createStripeAdminClient>;
  workspaceId: string;
  eventId: string;
  notification: ReturnType<typeof deriveBillingNotification>;
}) {
  if (!params.notification) {
    return;
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim();
  if (!resendApiKey) {
    console.warn('stripe-webhook missing RESEND_API_KEY; skipping billing email');
    return;
  }

  const appUrl = Deno.env.get('APP_URL')?.trim() || 'https://bizzybee.app';
  const supportEmail = Deno.env.get('BIZZYBEE_SUPPORT_EMAIL')?.trim() || 'support@bizzyb.ee';
  const transactionalFrom =
    Deno.env.get('RESEND_TRANSACTIONAL_FROM')?.trim() || 'BizzyBee <noreply@bizzyb.ee>';

  await sendWorkspaceLifecycleEmail({
    supabase: params.supabase,
    resendApiKey,
    workspaceId: params.workspaceId,
    kind: params.notification.kind,
    appUrl,
    supportEmail,
    transactionalFrom,
    details: params.notification.details,
    idempotencyKey: `stripe:${params.eventId}:${params.notification.kind}`,
  });
}

async function handleSubscriptionEvent(
  supabase: ReturnType<typeof createStripeAdminClient>,
  event: StripeEvent<StripeSubscription>,
) {
  const workspaceId = resolveWorkspaceIdFromSubscription(event.data.object);
  const previousSnapshot = workspaceId
    ? await loadPreviousBillingSnapshot(supabase, workspaceId)
    : null;
  const synced = await syncWorkspaceBillingFromSubscription(supabase, event.data.object);
  const notification = deriveBillingNotification({
    eventType: event.type,
    previous: previousSnapshot,
    current: {
      planKey: synced.planKey,
      addonKeys: synced.addonKeys,
      status: synced.status,
      cancelAtPeriodEnd: synced.cancelAtPeriodEnd,
      currentPeriodEnd: synced.currentPeriodEnd,
    },
  });

  await sendBillingNotification({
    supabase,
    workspaceId: synced.workspaceId,
    eventId: event.id,
    notification,
  });
}

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createStripeAdminClient>,
  event: StripeEvent<{
    subscription?: string | null;
    mode?: string | null;
  }>,
) {
  const subscriptionId = event.data.object.subscription?.trim();
  if (!subscriptionId || event.data.object.mode !== 'subscription') {
    return;
  }

  const subscription = await fetchSubscription(subscriptionId);
  await syncWorkspaceBillingFromSubscription(supabase, subscription);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature');
    const validSignature = await verifyStripeWebhookSignature(rawBody, signature);
    if (!validSignature) {
      throw new HttpError(401, 'Invalid Stripe webhook signature');
    }

    const event = await parseStripeWebhookEvent(rawBody);
    const supabase = createStripeAdminClient();

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(
          supabase,
          event as StripeEvent<{ subscription?: string | null; mode?: string | null }>,
        );
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionEvent(supabase, event as StripeEvent<StripeSubscription>);
        break;
      default:
        break;
    }

    return jsonResponse(200, { received: true });
  } catch (error) {
    console.error('stripe-webhook error', error);
    if (error instanceof HttpError) {
      return jsonResponse(error.status, { received: false, error: error.message });
    }

    return jsonResponse(500, {
      received: false,
      error: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});
