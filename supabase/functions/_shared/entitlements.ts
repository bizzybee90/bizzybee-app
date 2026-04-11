import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type BillingPlanKey = 'connect' | 'starter' | 'growth' | 'pro';
export type BillingAddonKey =
  | 'whatsapp_routing'
  | 'sms_routing'
  | 'whatsapp_ai'
  | 'sms_ai'
  | 'ai_phone';
export type BillingFeatureKey =
  | 'unified_inbox'
  | 'ai_inbox'
  | 'instagram_dm'
  | 'facebook_messenger'
  | 'auto_categorisation'
  | 'brand_rules'
  | 'knowledge_base'
  | 'analytics'
  | 'advanced_analytics'
  | 'priority_support';

export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
export type BillingEnforcementMode = 'legacy' | 'shadow' | 'soft' | 'hard';
export type BillingGuardSource = 'subscription' | 'legacy_fallback' | 'query_error_fallback';
export type BillingOverrideSource = 'workspace_override' | 'env_allowlist' | null;

export interface WorkspaceSubscriptionRecord {
  plan_key: BillingPlanKey;
  status: BillingStatus;
}

export interface WorkspaceAddonRecord {
  addon_key: BillingAddonKey;
  status: BillingStatus;
}

export interface WorkspaceBillingSnapshot {
  workspaceId: string;
  source: BillingGuardSource;
  plan: BillingPlanKey;
  status: BillingStatus;
  addons: Record<BillingAddonKey, boolean>;
  rolloutMode: BillingEnforcementMode;
  bypassActive: boolean;
  overrideSource: BillingOverrideSource;
  overrideReason: string | null;
}

export interface EntitlementGuardEvaluation {
  workspaceId: string;
  entitlementKey: BillingAddonKey;
  functionName: string;
  action: string;
  rolloutMode: BillingEnforcementMode;
  source: BillingGuardSource;
  isAllowed: boolean;
  wouldBlock: boolean;
  shouldBlock: boolean;
  bypassActive: boolean;
  overrideSource: BillingOverrideSource;
  overrideReason: string | null;
}

export interface FeatureGuardEvaluation {
  workspaceId: string;
  featureKey: BillingFeatureKey;
  functionName: string;
  action: string;
  rolloutMode: BillingEnforcementMode;
  source: BillingGuardSource;
  isAllowed: boolean;
  wouldBlock: boolean;
  shouldBlock: boolean;
  bypassActive: boolean;
  overrideSource: BillingOverrideSource;
  overrideReason: string | null;
}

interface WorkspaceBillingOverrideRecord {
  enforcement_mode?: string | null;
  allow_paid_features?: boolean | null;
  notes?: string | null;
}

export interface GetWorkspaceBillingSnapshotOptions {
  rolloutMode?: BillingEnforcementMode;
}

export interface RequireEntitlementInput {
  supabase: SupabaseClient;
  workspaceId: string;
  entitlementKey: BillingAddonKey;
  functionName: string;
  action: string;
  context?: Record<string, unknown>;
  rolloutMode?: BillingEnforcementMode;
  blockStatusCode?: number;
  snapshot?: WorkspaceBillingSnapshot;
}

export interface RequireFeatureInput {
  supabase: SupabaseClient;
  workspaceId: string;
  featureKey: BillingFeatureKey;
  functionName: string;
  action: string;
  context?: Record<string, unknown>;
  rolloutMode?: BillingEnforcementMode;
  blockStatusCode?: number;
  snapshot?: WorkspaceBillingSnapshot;
}

const ACTIVE_STATUSES: BillingStatus[] = ['trialing', 'active'];
const ENFORCEMENT_MODES: BillingEnforcementMode[] = ['legacy', 'shadow', 'soft', 'hard'];
const DEFAULT_ENFORCEMENT_MODE: BillingEnforcementMode = 'shadow';
const ENV_ENFORCEMENT_MODE_KEYS = [
  'BILLING_ENFORCEMENT_MODE',
  'BIZZYBEE_BILLING_ENFORCEMENT_MODE',
] as const;
const ENV_BYPASS_WORKSPACE_KEYS = [
  'BILLING_GUARD_BYPASS_WORKSPACE_IDS',
  'BILLING_TEST_BYPASS_WORKSPACES',
] as const;
const PLAN_FEATURES: Record<BillingPlanKey, Record<BillingFeatureKey, boolean>> = {
  connect: {
    unified_inbox: true,
    ai_inbox: false,
    instagram_dm: true,
    facebook_messenger: true,
    auto_categorisation: true,
    brand_rules: false,
    knowledge_base: false,
    analytics: false,
    advanced_analytics: false,
    priority_support: false,
  },
  starter: {
    unified_inbox: true,
    ai_inbox: true,
    instagram_dm: true,
    facebook_messenger: true,
    auto_categorisation: true,
    brand_rules: true,
    knowledge_base: true,
    analytics: false,
    advanced_analytics: false,
    priority_support: false,
  },
  growth: {
    unified_inbox: true,
    ai_inbox: true,
    instagram_dm: true,
    facebook_messenger: true,
    auto_categorisation: true,
    brand_rules: true,
    knowledge_base: true,
    analytics: true,
    advanced_analytics: false,
    priority_support: false,
  },
  pro: {
    unified_inbox: true,
    ai_inbox: true,
    instagram_dm: true,
    facebook_messenger: true,
    auto_categorisation: true,
    brand_rules: true,
    knowledge_base: true,
    analytics: true,
    advanced_analytics: true,
    priority_support: true,
  },
};

function isBillingStatus(status: string | null | undefined): status is BillingStatus {
  return Boolean(status && ['trialing', 'active', 'past_due', 'paused', 'canceled'].includes(status));
}

function isBillingPlanKey(plan: string | null | undefined): plan is BillingPlanKey {
  return Boolean(plan && ['connect', 'starter', 'growth', 'pro'].includes(plan));
}

function isBillingAddonKey(addon: string | null | undefined): addon is BillingAddonKey {
  return Boolean(
    addon &&
      ['whatsapp_routing', 'sms_routing', 'whatsapp_ai', 'sms_ai', 'ai_phone'].includes(addon),
  );
}

function parseBillingEnforcementMode(raw: string | null | undefined): BillingEnforcementMode | null {
  if (!raw) return null;
  const mode = raw.trim().toLowerCase();
  return ENFORCEMENT_MODES.includes(mode as BillingEnforcementMode)
    ? (mode as BillingEnforcementMode)
    : null;
}

function readEnvEnforcementMode(): BillingEnforcementMode {
  for (const key of ENV_ENFORCEMENT_MODE_KEYS) {
    const parsed = parseBillingEnforcementMode(Deno.env.get(key));
    if (parsed) return parsed;
  }
  return DEFAULT_ENFORCEMENT_MODE;
}

function parseWorkspaceAllowlist(): Set<string> {
  for (const key of ENV_BYPASS_WORKSPACE_KEYS) {
    const value = Deno.env.get(key);
    if (!value) continue;
    const ids = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (ids.length > 0) {
      return new Set(ids);
    }
  }
  return new Set<string>();
}

function isMissingRelationError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code?.toUpperCase();
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') {
    return true;
  }

  const message = error.message;
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('workspace_billing_overrides') &&
    (lower.includes('does not exist') ||
      lower.includes('relation') ||
      lower.includes('schema cache') ||
      lower.includes('could not find'))
  );
}

function getAddonMap(addons: WorkspaceAddonRecord[]): Record<BillingAddonKey, boolean> {
  return {
    whatsapp_routing: addons.some(
      (addon) => addon.addon_key === 'whatsapp_routing' && isBillingStatusActive(addon.status),
    ),
    sms_routing: addons.some(
      (addon) => addon.addon_key === 'sms_routing' && isBillingStatusActive(addon.status),
    ),
    whatsapp_ai: addons.some(
      (addon) => addon.addon_key === 'whatsapp_ai' && isBillingStatusActive(addon.status),
    ),
    sms_ai: addons.some(
      (addon) => addon.addon_key === 'sms_ai' && isBillingStatusActive(addon.status),
    ),
    ai_phone: addons.some(
      (addon) => addon.addon_key === 'ai_phone' && isBillingStatusActive(addon.status),
    ),
  };
}

export function isBillingStatusActive(status: BillingStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function resolveBillingSnapshot(
  subscription: WorkspaceSubscriptionRecord | null,
  addons: WorkspaceAddonRecord[],
) {
  if (!subscription) {
    return {
      source: 'legacy_fallback' as const,
      plan: 'connect' as BillingPlanKey,
      status: 'active' as BillingStatus,
      addons: {
        whatsapp_routing: false,
        sms_routing: false,
        whatsapp_ai: false,
        sms_ai: false,
        ai_phone: false,
      },
    };
  }

  return {
    source: 'subscription' as const,
    plan: subscription.plan_key,
    status: subscription.status,
    addons: getAddonMap(addons),
  };
}

async function readWorkspaceOverride(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{
  rolloutMode: BillingEnforcementMode | null;
  bypassActive: boolean;
  overrideSource: BillingOverrideSource;
  overrideReason: string | null;
}> {
  const envAllowlist = parseWorkspaceAllowlist();
  if (envAllowlist.has(workspaceId)) {
    return {
      rolloutMode: null,
      bypassActive: true,
      overrideSource: 'env_allowlist',
      overrideReason: 'workspace is in billing bypass allowlist',
    };
  }

  const { data, error } = await supabase
    .from('workspace_billing_overrides')
    .select('enforcement_mode, allow_paid_features, notes')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) {
    if (!isMissingRelationError({ message: error.message, code: error.code })) {
      console.warn('[billing-guard] Failed to fetch workspace override', {
        workspaceId,
        code: error.code ?? null,
        error: error.message,
      });
    }

    return {
      rolloutMode: null,
      bypassActive: false,
      overrideSource: null,
      overrideReason: null,
    };
  }

  if (!data) {
    return {
      rolloutMode: null,
      bypassActive: false,
      overrideSource: null,
      overrideReason: null,
    };
  }

  const record = data as WorkspaceBillingOverrideRecord;
  const rolloutMode = parseBillingEnforcementMode(record.enforcement_mode ?? null);
  const bypassActive = record.allow_paid_features === true;

  return {
    rolloutMode,
    bypassActive,
    overrideSource: 'workspace_override',
    overrideReason: record.notes?.trim() || null,
  };
}

export async function getWorkspaceBillingSnapshot(
  supabase: SupabaseClient,
  workspaceId: string,
  options: GetWorkspaceBillingSnapshotOptions = {},
): Promise<WorkspaceBillingSnapshot> {
  const [{ data: subscriptionData, error: subscriptionError }, { data: addonData, error: addonError }] =
    await Promise.all([
      supabase
        .from('workspace_subscriptions')
        .select('plan_key, status')
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
      supabase
        .from('workspace_addons')
        .select('addon_key, status')
        .eq('workspace_id', workspaceId),
    ]);

  const override = await readWorkspaceOverride(supabase, workspaceId);
  const rolloutMode = options.rolloutMode ?? override.rolloutMode ?? readEnvEnforcementMode();

  if (subscriptionError || addonError) {
    console.warn('[billing-guard] Falling back due to billing snapshot query error', {
      workspaceId,
      subscriptionError: subscriptionError?.message ?? null,
      addonError: addonError?.message ?? null,
      rolloutMode,
    });

    return {
      workspaceId,
      source: 'query_error_fallback',
      plan: 'connect',
      status: 'active',
      addons: {
        whatsapp_routing: false,
        sms_routing: false,
        whatsapp_ai: false,
        sms_ai: false,
        ai_phone: false,
      },
      rolloutMode,
      bypassActive: override.bypassActive,
      overrideSource: override.overrideSource,
      overrideReason: override.overrideReason,
    };
  }

  const subscription: WorkspaceSubscriptionRecord | null =
    subscriptionData &&
    isBillingPlanKey((subscriptionData as Record<string, unknown>).plan_key as string | null) &&
    isBillingStatus((subscriptionData as Record<string, unknown>).status as string | null)
      ? {
          plan_key: (subscriptionData as Record<string, unknown>).plan_key as BillingPlanKey,
          status: (subscriptionData as Record<string, unknown>).status as BillingStatus,
        }
      : null;

  const addons: WorkspaceAddonRecord[] = (Array.isArray(addonData) ? addonData : [])
    .map((row) => row as Record<string, unknown>)
    .filter(
      (row) =>
        isBillingAddonKey((row.addon_key as string | null) ?? null) &&
        isBillingStatus((row.status as string | null) ?? null),
    )
    .map((row) => ({
      addon_key: row.addon_key as BillingAddonKey,
      status: row.status as BillingStatus,
    }));

  const resolved = resolveBillingSnapshot(subscription, addons);

  return {
    workspaceId,
    source: resolved.source,
    plan: resolved.plan,
    status: resolved.status,
    addons: resolved.addons,
    rolloutMode,
    bypassActive: override.bypassActive,
    overrideSource: override.overrideSource,
    overrideReason: override.overrideReason,
  };
}

export function evaluateEntitlementGuard(
  snapshot: WorkspaceBillingSnapshot,
  entitlementKey: BillingAddonKey,
  functionName: string,
  action: string,
): EntitlementGuardEvaluation {
  const subscriptionActive = isBillingStatusActive(snapshot.status);
  const isAllowed = subscriptionActive && snapshot.addons[entitlementKey];
  const wouldBlock = !isAllowed;

  let shouldBlock = false;
  if (snapshot.rolloutMode === 'soft' || snapshot.rolloutMode === 'hard') {
    shouldBlock = wouldBlock && !snapshot.bypassActive;
  }

  return {
    workspaceId: snapshot.workspaceId,
    entitlementKey,
    functionName,
    action,
    rolloutMode: snapshot.rolloutMode,
    source: snapshot.source,
    isAllowed,
    wouldBlock,
    shouldBlock,
    bypassActive: snapshot.bypassActive,
    overrideSource: snapshot.overrideSource,
    overrideReason: snapshot.overrideReason,
  };
}

export function evaluateFeatureGuard(
  snapshot: WorkspaceBillingSnapshot,
  featureKey: BillingFeatureKey,
  functionName: string,
  action: string,
): FeatureGuardEvaluation {
  const subscriptionActive = isBillingStatusActive(snapshot.status);
  const featureAllowed = PLAN_FEATURES[snapshot.plan]?.[featureKey] === true;
  const isAllowed = subscriptionActive && featureAllowed;
  const wouldBlock = !isAllowed;

  let shouldBlock = false;
  if (snapshot.rolloutMode === 'soft' || snapshot.rolloutMode === 'hard') {
    shouldBlock = wouldBlock && !snapshot.bypassActive;
  }

  return {
    workspaceId: snapshot.workspaceId,
    featureKey,
    functionName,
    action,
    rolloutMode: snapshot.rolloutMode,
    source: snapshot.source,
    isAllowed,
    wouldBlock,
    shouldBlock,
    bypassActive: snapshot.bypassActive,
    overrideSource: snapshot.overrideSource,
    overrideReason: snapshot.overrideReason,
  };
}

export function logEntitlementGuardDecision(
  evaluation: EntitlementGuardEvaluation,
  context: Record<string, unknown> = {},
) {
  console.log(
    JSON.stringify({
      event: 'billing_guard_evaluated',
      timestamp: new Date().toISOString(),
      ...evaluation,
      context,
    }),
  );
}

export function logFeatureGuardDecision(
  evaluation: FeatureGuardEvaluation,
  context: Record<string, unknown> = {},
) {
  console.log(
    JSON.stringify({
      event: 'billing_feature_guard_evaluated',
      timestamp: new Date().toISOString(),
      ...evaluation,
      context,
    }),
  );
}

export class EntitlementGuardError extends Error {
  statusCode: number;
  code: string;
  evaluation: EntitlementGuardEvaluation;

  constructor(evaluation: EntitlementGuardEvaluation, statusCode = 402) {
    super(`Blocked by billing guard for entitlement ${evaluation.entitlementKey}`);
    this.name = 'EntitlementGuardError';
    this.statusCode = statusCode;
    this.code = 'billing_entitlement_blocked';
    this.evaluation = evaluation;
  }
}

export class FeatureGuardError extends Error {
  statusCode: number;
  code: string;
  evaluation: FeatureGuardEvaluation;

  constructor(evaluation: FeatureGuardEvaluation, statusCode = 402) {
    super(`Blocked by billing feature guard for feature ${evaluation.featureKey}`);
    this.name = 'FeatureGuardError';
    this.statusCode = statusCode;
    this.code = 'billing_feature_blocked';
    this.evaluation = evaluation;
  }
}

export function entitlementGuardErrorResponse(
  error: EntitlementGuardError,
  corsHeaders: Record<string, string>,
) {
  return new Response(
    JSON.stringify({
      error: 'This action requires an active subscription add-on.',
      code: error.code,
      entitlement_key: error.evaluation.entitlementKey,
      rollout_mode: error.evaluation.rolloutMode,
      workspace_id: error.evaluation.workspaceId,
      function_name: error.evaluation.functionName,
      action: error.evaluation.action,
      bypass_active: error.evaluation.bypassActive,
      override_source: error.evaluation.overrideSource,
      would_block: error.evaluation.wouldBlock,
    }),
    {
      status: error.statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
}

export function featureGuardErrorResponse(
  error: FeatureGuardError,
  corsHeaders: Record<string, string>,
) {
  return new Response(
    JSON.stringify({
      error: 'This action requires a higher-tier subscription feature.',
      code: error.code,
      feature_key: error.evaluation.featureKey,
      rollout_mode: error.evaluation.rolloutMode,
      workspace_id: error.evaluation.workspaceId,
      function_name: error.evaluation.functionName,
      action: error.evaluation.action,
      bypass_active: error.evaluation.bypassActive,
      override_source: error.evaluation.overrideSource,
      would_block: error.evaluation.wouldBlock,
    }),
    {
      status: error.statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
}

export async function requireEntitlement(
  input: RequireEntitlementInput,
): Promise<{ snapshot: WorkspaceBillingSnapshot; evaluation: EntitlementGuardEvaluation }> {
  const snapshot =
    input.snapshot ??
    (await getWorkspaceBillingSnapshot(input.supabase, input.workspaceId, {
      rolloutMode: input.rolloutMode,
    }));

  const evaluation = evaluateEntitlementGuard(
    snapshot,
    input.entitlementKey,
    input.functionName,
    input.action,
  );

  logEntitlementGuardDecision(evaluation, input.context);

  if (evaluation.shouldBlock) {
    throw new EntitlementGuardError(evaluation, input.blockStatusCode);
  }

  return { snapshot, evaluation };
}

export async function requireFeature(
  input: RequireFeatureInput,
): Promise<{ snapshot: WorkspaceBillingSnapshot; evaluation: FeatureGuardEvaluation }> {
  const snapshot =
    input.snapshot ??
    (await getWorkspaceBillingSnapshot(input.supabase, input.workspaceId, {
      rolloutMode: input.rolloutMode,
    }));

  const evaluation = evaluateFeatureGuard(snapshot, input.featureKey, input.functionName, input.action);

  logFeatureGuardDecision(evaluation, input.context);

  if (evaluation.shouldBlock) {
    throw new FeatureGuardError(evaluation, input.blockStatusCode);
  }

  return { snapshot, evaluation };
}
