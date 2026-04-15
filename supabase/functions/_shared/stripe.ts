import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { HttpError, getRequiredEnv } from './pipeline.ts';
import { verifyStripeWebhookSignatureValue } from './stripeWebhookAuth.ts';
import {
  getAddonLookupKey,
  getPlanLookupKey,
  isStripeBillingAddonKey,
  isStripeBillingPlanKey,
  resolveStripeCatalogEntry,
  type StripeBillingAddonKey,
  type StripeBillingPlanKey,
} from './stripeCatalog.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

export interface StripePrice {
  id: string;
  lookup_key: string | null;
  metadata?: Record<string, string>;
}

export interface StripeSubscriptionItem {
  id: string;
  price: StripePrice;
  quantity: number | null;
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_start: number | null;
  current_period_end: number | null;
  trial_end: number | null;
  metadata?: Record<string, string>;
  items: {
    data: StripeSubscriptionItem[];
  };
}

export interface StripeEvent<T = unknown> {
  id: string;
  type: string;
  data: {
    object: T;
  };
}

type WorkspaceSubscriptionRow = {
  workspace_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_key: string;
  status: string;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
};

function stripeSecretKey(): string {
  return getRequiredEnv('STRIPE_SECRET_KEY');
}

export function getStripePortalConfigurationId(): string {
  return getRequiredEnv('STRIPE_PORTAL_CONFIGURATION_ID');
}

export function getStripeWebhookSecret(): string {
  return getRequiredEnv('STRIPE_WEBHOOK_SECRET');
}

export function createStripeAdminClient(): SupabaseClient {
  return createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-bb-component': 'stripe' } },
  });
}

function encodeFormBody(data: Record<string, string | number | boolean>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    body.append(key, String(value));
  }
  return body;
}

async function stripeRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: URLSearchParams;
  } = {},
): Promise<T> {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${stripeSecretKey()}`,
      ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: options.body,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      payload?.error?.message || `Stripe request failed (${response.status}) at ${path}`;
    throw new HttpError(response.status, message);
  }

  return payload as T;
}

export function mapStripeStatus(
  status: string | null | undefined,
): 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'canceled':
      return 'canceled';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
      return 'past_due';
    default:
      return 'past_due';
  }
}

function toIso(timestamp: number | null | undefined): string | null {
  if (!timestamp) return null;
  return new Date(timestamp * 1000).toISOString();
}

function safeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, string> {
  if (!metadata || typeof metadata !== 'object') return {};
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([key, value]) => [key, value as string]),
  );
}

export async function getPriceForLookupKey(lookupKey: string): Promise<StripePrice> {
  const response = await stripeRequest<{ data: StripePrice[] }>(
    `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`,
  );

  const price = response.data?.[0];
  if (!price?.id) {
    throw new HttpError(400, `No active Stripe price found for lookup key ${lookupKey}`);
  }

  return price;
}

export async function ensureStripeCustomerForWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  const { data: existingSubscription, error: existingError } = await supabase
    .from('workspace_subscriptions')
    .select('stripe_customer_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(500, `Failed to load billing state: ${existingError.message}`);
  }

  if (existingSubscription?.stripe_customer_id) {
    return existingSubscription.stripe_customer_id;
  }

  const [{ data: workspace, error: workspaceError }, { data: primaryUser, error: userError }] =
    await Promise.all([
      supabase.from('workspaces').select('name').eq('id', workspaceId).single(),
      supabase
        .from('users')
        .select('email, name')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  if (workspaceError) {
    throw new HttpError(500, `Failed to load workspace: ${workspaceError.message}`);
  }
  if (userError) {
    throw new HttpError(500, `Failed to load workspace user: ${userError.message}`);
  }

  const customer = await stripeRequest<{ id: string }>('/customers', {
    method: 'POST',
    body: encodeFormBody({
      name: workspace.name ?? 'BizzyBee Workspace',
      email: primaryUser?.email ?? '',
      'metadata[workspace_id]': workspaceId,
      'metadata[source]': 'bizzybee',
    }),
  });

  if (!customer.id) {
    throw new HttpError(500, 'Stripe did not return a customer id');
  }

  return customer.id;
}

export async function createCheckoutSession(params: {
  customerId: string;
  workspaceId: string;
  planKey: StripeBillingPlanKey;
  addonKeys: StripeBillingAddonKey[];
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string | null }> {
  const prices = await Promise.all([
    getPriceForLookupKey(getPlanLookupKey(params.planKey)),
    ...params.addonKeys.map((addonKey) => getPriceForLookupKey(getAddonLookupKey(addonKey))),
  ]);

  const lineItems = prices.flatMap((price, index) => [
    [`line_items[${index}][price]`, price.id],
    [`line_items[${index}][quantity]`, '1'],
  ]);

  const body = encodeFormBody({
    mode: 'subscription',
    customer: params.customerId,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    'subscription_data[metadata][workspace_id]': params.workspaceId,
    'subscription_data[metadata][source]': 'bizzybee_checkout',
  });

  for (const [key, value] of lineItems) {
    body.append(key, value);
  }

  return stripeRequest<{ id: string; url: string | null }>('/checkout/sessions', {
    method: 'POST',
    body,
  });
}

export async function createPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  return stripeRequest<{ url: string }>('/billing_portal/sessions', {
    method: 'POST',
    body: encodeFormBody({
      customer: params.customerId,
      return_url: params.returnUrl,
      configuration: getStripePortalConfigurationId(),
    }),
  });
}

export async function fetchPrice(priceId: string): Promise<StripePrice> {
  return stripeRequest<StripePrice>(`/prices/${encodeURIComponent(priceId)}`);
}

async function getResolvedPriceCatalogEntry(price: StripePrice) {
  const direct = resolveStripeCatalogEntry({
    lookupKey: price.lookup_key,
    metadata: safeMetadata(price.metadata),
  });
  if (direct) {
    return direct;
  }

  const refreshedPrice = await fetchPrice(price.id);
  return resolveStripeCatalogEntry({
    lookupKey: refreshedPrice.lookup_key,
    metadata: safeMetadata(refreshedPrice.metadata),
  });
}

export async function fetchCustomer(customerId: string): Promise<{
  id: string;
  metadata?: Record<string, string>;
}> {
  return stripeRequest<{ id: string; metadata?: Record<string, string> }>(
    `/customers/${encodeURIComponent(customerId)}`,
  );
}

export async function fetchSubscription(subscriptionId: string): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price`,
  );
}

async function resolveWorkspaceIdForSubscription(
  supabase: SupabaseClient,
  subscription: StripeSubscription,
): Promise<string> {
  const metadataWorkspaceId = subscription.metadata?.workspace_id?.trim();
  if (metadataWorkspaceId) {
    return metadataWorkspaceId;
  }

  const { data: existingRow, error: existingError } = await supabase
    .from('workspace_subscriptions')
    .select('workspace_id')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(
      500,
      `Failed to resolve workspace by subscription: ${existingError.message}`,
    );
  }
  if (existingRow?.workspace_id) {
    return existingRow.workspace_id;
  }

  const { data: customerRow, error: customerError } = await supabase
    .from('workspace_subscriptions')
    .select('workspace_id')
    .eq('stripe_customer_id', subscription.customer)
    .maybeSingle();

  if (customerError) {
    throw new HttpError(500, `Failed to resolve workspace by customer: ${customerError.message}`);
  }
  if (customerRow?.workspace_id) {
    return customerRow.workspace_id;
  }

  const customer = await fetchCustomer(subscription.customer);
  const customerWorkspaceId = customer.metadata?.workspace_id?.trim();
  if (!customerWorkspaceId) {
    throw new HttpError(
      400,
      `No workspace metadata found for Stripe customer ${subscription.customer}`,
    );
  }

  return customerWorkspaceId;
}

async function resolveCatalogForItem(item: StripeSubscriptionItem) {
  const resolved = await getResolvedPriceCatalogEntry(item.price);

  if (!resolved) {
    throw new HttpError(400, `Unmapped Stripe price ${item.price.id}`);
  }

  return resolved;
}

export async function syncWorkspaceBillingFromSubscription(
  supabase: SupabaseClient,
  subscription: StripeSubscription,
): Promise<{
  workspaceId: string;
  planKey: StripeBillingPlanKey;
  addonKeys: StripeBillingAddonKey[];
  status: ReturnType<typeof mapStripeStatus>;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}> {
  const workspaceId = await resolveWorkspaceIdForSubscription(supabase, subscription);
  const status = mapStripeStatus(subscription.status);

  let planKey: StripeBillingPlanKey | null = null;
  let planPriceId: string | null = null;
  const addonStates = new Map<
    StripeBillingAddonKey,
    {
      subscriptionItemId: string;
      priceId: string;
      quantity: number;
    }
  >();

  for (const item of subscription.items.data ?? []) {
    const catalogEntry = await resolveCatalogForItem(item);
    if (catalogEntry.objectType === 'plan') {
      planKey = catalogEntry.planKey;
      planPriceId = item.price.id;
      continue;
    }

    addonStates.set(catalogEntry.addonKey, {
      subscriptionItemId: item.id,
      priceId: item.price.id,
      quantity: item.quantity ?? 1,
    });
  }

  if (!planKey || !isStripeBillingPlanKey(planKey)) {
    throw new HttpError(
      400,
      `Stripe subscription ${subscription.id} is missing a mapped base plan`,
    );
  }

  const subscriptionRow = {
    workspace_id: workspaceId,
    plan_key: planKey,
    status,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    stripe_price_id: planPriceId,
    current_period_start: toIso(subscription.current_period_start),
    current_period_end: toIso(subscription.current_period_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    trial_ends_at: toIso(subscription.trial_end),
    metadata: safeMetadata(subscription.metadata),
    updated_at: new Date().toISOString(),
  };

  const { error: subscriptionError } = await supabase
    .from('workspace_subscriptions')
    .upsert(subscriptionRow, { onConflict: 'workspace_id' });

  if (subscriptionError) {
    throw new HttpError(500, `Failed to sync workspace subscription: ${subscriptionError.message}`);
  }

  for (const [addonKey, addonState] of addonStates.entries()) {
    const { error: addonError } = await supabase.from('workspace_addons').upsert(
      {
        workspace_id: workspaceId,
        addon_key: addonKey,
        status,
        stripe_subscription_item_id: addonState.subscriptionItemId,
        stripe_price_id: addonState.priceId,
        quantity: addonState.quantity,
        started_at: toIso(subscription.current_period_start) ?? new Date().toISOString(),
        ended_at: status === 'canceled' ? new Date().toISOString() : null,
        metadata: {
          source: 'stripe_subscription',
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,addon_key' },
    );

    if (addonError) {
      throw new HttpError(
        500,
        `Failed to sync workspace add-on ${addonKey}: ${addonError.message}`,
      );
    }
  }

  const activeAddonKeys = Array.from(addonStates.keys());
  const { data: existingAddons, error: existingAddonsError } = await supabase
    .from('workspace_addons')
    .select('addon_key')
    .eq('workspace_id', workspaceId);

  if (existingAddonsError) {
    throw new HttpError(500, `Failed to load existing add-ons: ${existingAddonsError.message}`);
  }

  const missingAddonKeys = (existingAddons || [])
    .map((row) => row.addon_key)
    .filter((addonKey): addonKey is StripeBillingAddonKey => isStripeBillingAddonKey(addonKey))
    .filter((addonKey) => !activeAddonKeys.includes(addonKey));

  if (missingAddonKeys.length > 0) {
    const { error: cleanupError } = await supabase
      .from('workspace_addons')
      .update({
        status: 'canceled',
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .in('addon_key', missingAddonKeys);

    if (cleanupError) {
      throw new HttpError(500, `Failed to expire removed add-ons: ${cleanupError.message}`);
    }
  }

  return {
    workspaceId,
    planKey,
    addonKeys: activeAddonKeys,
    status,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodEnd: toIso(subscription.current_period_end),
  };
}

export async function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret = getStripeWebhookSecret(),
): Promise<boolean> {
  return verifyStripeWebhookSignatureValue({
    rawBody,
    signatureHeader,
    secret,
  });
}

export async function parseStripeWebhookEvent(rawBody: string): Promise<StripeEvent> {
  const parsed = JSON.parse(rawBody) as StripeEvent;
  if (!parsed?.id || !parsed?.type || !parsed?.data?.object) {
    throw new HttpError(400, 'Invalid Stripe webhook payload');
  }
  return parsed;
}

export async function loadWorkspaceSubscription(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceSubscriptionRow | null> {
  const { data, error } = await supabase
    .from('workspace_subscriptions')
    .select(
      'workspace_id, stripe_customer_id, stripe_subscription_id, plan_key, status, cancel_at_period_end, current_period_end',
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, `Failed to load workspace subscription: ${error.message}`);
  }

  return data;
}
