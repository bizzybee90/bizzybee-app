import type { Database } from '@/integrations/supabase/types';
import {
  BIZZYBEE_ADDONS,
  BIZZYBEE_PLANS,
  type BizzyBeePlanLimits,
  type BizzyBeeAddonKey,
  type BizzyBeeFeatureKey,
  type BizzyBeePlanKey,
} from './plans';

export type WorkspaceSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'canceled';

export type WorkspaceSubscriptionRow =
  Database['public']['Tables']['workspace_subscriptions']['Row'];

export type WorkspaceAddonRow = Database['public']['Tables']['workspace_addons']['Row'];

export type BillingEnforcementMode = 'legacy' | 'shadow' | 'soft' | 'hard';
export type WorkspaceEntitlementSource = 'subscription' | 'legacy_fallback';
export type WorkspaceEntitlementDecisionSource = WorkspaceEntitlementSource | 'override';
export type WorkspaceOverrideSource =
  | 'workspace_override'
  | 'preview_override'
  | 'env_override'
  | 'test_override';
export type WorkspaceEntitlementResolutionPath =
  | 'subscription'
  | 'missing_subscription'
  | 'read_error_fallback';

export interface WorkspaceBillingOverride {
  source: WorkspaceOverrideSource;
  rolloutMode?: BillingEnforcementMode;
  allowPaidFeatures?: boolean;
  plan?: BizzyBeePlanKey;
  addons?: Partial<Record<BizzyBeeAddonKey, boolean>>;
  note?: string;
}

export interface WorkspaceEntitlementDecision {
  isAllowed: boolean;
  wouldBlock: boolean;
  rolloutMode: BillingEnforcementMode;
  source: WorkspaceEntitlementDecisionSource;
}

export type WorkspaceCapabilityKey =
  | 'aiInbox'
  | 'instagramAi'
  | 'facebookAi'
  | 'whatsAppAi'
  | 'whatsAppRouting'
  | 'smsAi'
  | 'smsRouting'
  | 'aiPhone';

export interface WorkspaceEntitlements {
  source: WorkspaceEntitlementSource;
  rolloutMode: BillingEnforcementMode;
  resolution: {
    path: WorkspaceEntitlementResolutionPath;
    readErrorSafetyDowngrade: boolean;
    intentionalBypass: boolean;
  };
  plan: BizzyBeePlanKey;
  subscriptionStatus: WorkspaceSubscriptionStatus;
  override: {
    applied: boolean;
    source: WorkspaceOverrideSource | 'none';
    allowPaidFeatures: boolean;
    note: string | null;
  };
  decisions: {
    features: Record<BizzyBeeFeatureKey, WorkspaceEntitlementDecision>;
    capabilities: Record<WorkspaceCapabilityKey, WorkspaceEntitlementDecision>;
  };
  addons: Record<BizzyBeeAddonKey, boolean>;
  features: Record<BizzyBeeFeatureKey, boolean>;
  limits: {
    emailHistoryImportLimit: number;
    includedSms: number;
    includedPhoneMinutes: number;
  };
  canUseAiInbox: boolean;
  canUseInstagramAi: boolean;
  canUseFacebookAi: boolean;
  canUseWhatsAppAi: boolean;
  canUseWhatsAppRouting: boolean;
  canUseSmsAi: boolean;
  canUseSmsRouting: boolean;
  canUseAiPhone: boolean;
}

export interface ResolveWorkspaceEntitlementsOptions {
  rolloutMode?: BillingEnforcementMode;
  override?: WorkspaceBillingOverride | null;
  resolutionPath?: WorkspaceEntitlementResolutionPath;
}

const BILLING_ENFORCEMENT_MODES = ['legacy', 'shadow', 'soft', 'hard'] as const;
const DEFAULT_BILLING_ENFORCEMENT_MODE: BillingEnforcementMode = 'shadow';
const ACTIVE_STATUSES: WorkspaceSubscriptionStatus[] = ['trialing', 'active'];
const BILLING_CAPABILITIES: Record<
  WorkspaceCapabilityKey,
  (input: {
    features: Record<BizzyBeeFeatureKey, boolean>;
    addons: Record<BizzyBeeAddonKey, boolean>;
    isSubscriptionActive: boolean;
  }) => boolean
> = {
  aiInbox: ({ features, isSubscriptionActive }) => features.ai_inbox && isSubscriptionActive,
  instagramAi: ({ features, isSubscriptionActive }) =>
    features.instagram_dm && features.ai_inbox && isSubscriptionActive,
  facebookAi: ({ features, isSubscriptionActive }) =>
    features.facebook_messenger && features.ai_inbox && isSubscriptionActive,
  whatsAppAi: ({ addons, features, isSubscriptionActive }) =>
    addons.whatsapp_ai && features.ai_inbox && isSubscriptionActive,
  whatsAppRouting: ({ addons, isSubscriptionActive }) =>
    (addons.whatsapp_routing || addons.whatsapp_ai) && isSubscriptionActive,
  smsAi: ({ addons, features, isSubscriptionActive }) =>
    addons.sms_ai && features.ai_inbox && isSubscriptionActive,
  smsRouting: ({ addons, isSubscriptionActive }) =>
    (addons.sms_routing || addons.sms_ai) && isSubscriptionActive,
  aiPhone: ({ addons, isSubscriptionActive }) => addons.ai_phone && isSubscriptionActive,
};

function isBillingEnforcementMode(
  value: string | null | undefined,
): value is BillingEnforcementMode {
  return Boolean(value && BILLING_ENFORCEMENT_MODES.includes(value as BillingEnforcementMode));
}

function isStatusActive(status: string | null | undefined): status is WorkspaceSubscriptionStatus {
  return Boolean(status && ACTIVE_STATUSES.includes(status as WorkspaceSubscriptionStatus));
}

function isPlanKey(value: string | null | undefined): value is BizzyBeePlanKey {
  return Boolean(value && value in BIZZYBEE_PLANS);
}

function isAddonKey(value: string | null | undefined): value is BizzyBeeAddonKey {
  return Boolean(value && value in BIZZYBEE_ADDONS);
}

function resolveRolloutMode(
  optionsMode?: BillingEnforcementMode,
  overrideMode?: BillingEnforcementMode,
): BillingEnforcementMode {
  if (overrideMode) {
    return overrideMode;
  }

  if (optionsMode) {
    return optionsMode;
  }

  const envMode = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env?.VITE_BILLING_ENFORCEMENT_MODE;

  if (isBillingEnforcementMode(envMode)) {
    return envMode;
  }

  return DEFAULT_BILLING_ENFORCEMENT_MODE;
}

function resolveResolutionPath(
  explicitPath: WorkspaceEntitlementResolutionPath | undefined,
  hasSubscription: boolean,
): WorkspaceEntitlementResolutionPath {
  if (explicitPath) {
    return explicitPath;
  }

  return hasSubscription ? 'subscription' : 'missing_subscription';
}

function applyReadErrorSafetyMode(input: {
  rolloutMode: BillingEnforcementMode;
  resolutionPath: WorkspaceEntitlementResolutionPath;
  override?: WorkspaceBillingOverride | null;
}): {
  mode: BillingEnforcementMode;
  downgraded: boolean;
} {
  if (input.resolutionPath !== 'read_error_fallback') {
    return { mode: input.rolloutMode, downgraded: false };
  }

  if (input.override?.allowPaidFeatures) {
    return { mode: input.rolloutMode, downgraded: false };
  }

  if (input.rolloutMode === 'legacy' || input.rolloutMode === 'shadow') {
    return { mode: 'soft', downgraded: true };
  }

  return { mode: input.rolloutMode, downgraded: false };
}

function buildBaselineAddonMap(
  plan: BizzyBeePlanKey,
  activeAddons: Iterable<BizzyBeeAddonKey>,
  override?: WorkspaceBillingOverride | null,
): Record<BizzyBeeAddonKey, boolean> {
  const addonSet = new Set(activeAddons);
  const base = {
    whatsapp_routing: addonSet.has('whatsapp_routing'),
    sms_routing: addonSet.has('sms_routing'),
    whatsapp_ai: addonSet.has('whatsapp_ai'),
    sms_ai: addonSet.has('sms_ai'),
    ai_phone: addonSet.has('ai_phone'),
  };

  // Keep normal behavior strict by plan, but allow explicit testing overrides.
  const normalized: Record<BizzyBeeAddonKey, boolean> = {
    whatsapp_routing:
      base.whatsapp_routing && BIZZYBEE_PLANS[plan].allowedAddons.includes('whatsapp_routing'),
    sms_routing: base.sms_routing && BIZZYBEE_PLANS[plan].allowedAddons.includes('sms_routing'),
    whatsapp_ai: base.whatsapp_ai && BIZZYBEE_PLANS[plan].allowedAddons.includes('whatsapp_ai'),
    sms_ai: base.sms_ai && BIZZYBEE_PLANS[plan].allowedAddons.includes('sms_ai'),
    ai_phone: base.ai_phone && BIZZYBEE_PLANS[plan].allowedAddons.includes('ai_phone'),
  };

  if (override?.addons) {
    for (const [addonKey, value] of Object.entries(override.addons)) {
      if (isAddonKey(addonKey) && typeof value === 'boolean') {
        normalized[addonKey] = value;
      }
    }
  }

  return normalized;
}

function getBypassedEmailHistoryImportLimit(): number {
  return Math.max(
    ...Object.values(BIZZYBEE_PLANS).map((plan) => plan.limits.emailHistoryImportLimit),
  );
}

function resolveLimits(
  planLimits: BizzyBeePlanLimits,
  addons: Record<BizzyBeeAddonKey, boolean>,
  allowPaidFeatures: boolean,
): WorkspaceEntitlements['limits'] {
  return {
    emailHistoryImportLimit: allowPaidFeatures
      ? getBypassedEmailHistoryImportLimit()
      : planLimits.emailHistoryImportLimit,
    includedSms: addons.sms_ai ? (BIZZYBEE_ADDONS.sms_ai.includedUnits ?? 0) : 0,
    includedPhoneMinutes: addons.ai_phone ? (BIZZYBEE_ADDONS.ai_phone.includedUnits ?? 0) : 0,
  };
}

function resolveDecision(
  isBaseAllowed: boolean,
  source: WorkspaceEntitlementSource,
  rolloutMode: BillingEnforcementMode,
  allowPaidFeatures: boolean,
): WorkspaceEntitlementDecision {
  const wouldBlock = !isBaseAllowed;

  if (allowPaidFeatures) {
    return {
      isAllowed: true,
      wouldBlock,
      rolloutMode,
      source: 'override',
    };
  }

  if (rolloutMode === 'soft' || rolloutMode === 'hard') {
    return {
      isAllowed: isBaseAllowed,
      wouldBlock,
      rolloutMode,
      source,
    };
  }

  return {
    isAllowed: true,
    wouldBlock,
    rolloutMode,
    source,
  };
}

function buildResolvedEntitlements(input: {
  source: WorkspaceEntitlementSource;
  resolutionPath: WorkspaceEntitlementResolutionPath;
  readErrorSafetyDowngrade: boolean;
  plan: BizzyBeePlanKey;
  subscriptionStatus: WorkspaceSubscriptionStatus;
  addonKeys: Iterable<BizzyBeeAddonKey>;
  rolloutMode: BillingEnforcementMode;
  override?: WorkspaceBillingOverride | null;
}): WorkspaceEntitlements {
  const planDef = BIZZYBEE_PLANS[input.plan];
  const isSubscriptionActive = isStatusActive(input.subscriptionStatus);
  const addons = buildBaselineAddonMap(input.plan, input.addonKeys, input.override);
  const allowPaidFeatures = Boolean(input.override?.allowPaidFeatures);

  const featureDecisions = Object.entries(planDef.features).reduce(
    (acc, [featureKey, isBaseAllowed]) => {
      const typedFeatureKey = featureKey as BizzyBeeFeatureKey;
      acc[typedFeatureKey] = resolveDecision(
        isBaseAllowed,
        input.source,
        input.rolloutMode,
        allowPaidFeatures,
      );
      return acc;
    },
    {} as Record<BizzyBeeFeatureKey, WorkspaceEntitlementDecision>,
  );

  const capabilityDecisions = (
    Object.entries(BILLING_CAPABILITIES) as Array<
      [WorkspaceCapabilityKey, (typeof BILLING_CAPABILITIES)[WorkspaceCapabilityKey]]
    >
  ).reduce(
    (acc, [capabilityKey, resolver]) => {
      const isBaseAllowed = resolver({
        features: planDef.features,
        addons,
        isSubscriptionActive,
      });

      acc[capabilityKey] = resolveDecision(
        isBaseAllowed,
        input.source,
        input.rolloutMode,
        allowPaidFeatures,
      );

      return acc;
    },
    {} as Record<WorkspaceCapabilityKey, WorkspaceEntitlementDecision>,
  );

  return {
    source: input.source,
    rolloutMode: input.rolloutMode,
    resolution: {
      path: input.resolutionPath,
      readErrorSafetyDowngrade: input.readErrorSafetyDowngrade,
      intentionalBypass: allowPaidFeatures,
    },
    plan: input.plan,
    subscriptionStatus: input.subscriptionStatus,
    override: {
      applied: Boolean(input.override),
      source: input.override?.source ?? 'none',
      allowPaidFeatures,
      note: input.override?.note ?? null,
    },
    decisions: {
      features: featureDecisions,
      capabilities: capabilityDecisions,
    },
    addons,
    features: {
      unified_inbox: featureDecisions.unified_inbox.isAllowed,
      ai_inbox: featureDecisions.ai_inbox.isAllowed,
      instagram_dm: featureDecisions.instagram_dm.isAllowed,
      facebook_messenger: featureDecisions.facebook_messenger.isAllowed,
      auto_categorisation: featureDecisions.auto_categorisation.isAllowed,
      brand_rules: featureDecisions.brand_rules.isAllowed,
      knowledge_base: featureDecisions.knowledge_base.isAllowed,
      analytics: featureDecisions.analytics.isAllowed,
      advanced_analytics: featureDecisions.advanced_analytics.isAllowed,
      priority_support: featureDecisions.priority_support.isAllowed,
    },
    limits: resolveLimits(planDef.limits, addons, allowPaidFeatures),
    canUseAiInbox: capabilityDecisions.aiInbox.isAllowed,
    canUseInstagramAi: capabilityDecisions.instagramAi.isAllowed,
    canUseFacebookAi: capabilityDecisions.facebookAi.isAllowed,
    canUseWhatsAppAi: capabilityDecisions.whatsAppAi.isAllowed,
    canUseWhatsAppRouting: capabilityDecisions.whatsAppRouting.isAllowed,
    canUseSmsAi: capabilityDecisions.smsAi.isAllowed,
    canUseSmsRouting: capabilityDecisions.smsRouting.isAllowed,
    canUseAiPhone: capabilityDecisions.aiPhone.isAllowed,
  };
}

export function getDefaultBillingEnforcementMode(): BillingEnforcementMode {
  return resolveRolloutMode();
}

export function resolveWorkspaceEntitlements(
  subscription: WorkspaceSubscriptionRow | null,
  addons: WorkspaceAddonRow[],
  options: ResolveWorkspaceEntitlementsOptions = {},
): WorkspaceEntitlements {
  const requestedOverride = options.override ?? null;
  const requestedRolloutMode = resolveRolloutMode(
    options.rolloutMode,
    requestedOverride?.rolloutMode,
  );
  const resolutionPath = resolveResolutionPath(options.resolutionPath, Boolean(subscription));
  const { mode: rolloutMode, downgraded: readErrorSafetyDowngrade } = applyReadErrorSafetyMode({
    rolloutMode: requestedRolloutMode,
    resolutionPath,
    override: requestedOverride,
  });
  const plan = isPlanKey(requestedOverride?.plan)
    ? requestedOverride.plan
    : isPlanKey(subscription?.plan_key)
      ? subscription.plan_key
      : 'connect';
  const source: WorkspaceEntitlementSource = subscription ? 'subscription' : 'legacy_fallback';

  const subscriptionStatus: WorkspaceSubscriptionStatus = isStatusActive(subscription?.status)
    ? subscription.status
    : (subscription?.status as WorkspaceSubscriptionStatus) || 'active';

  const addonKeys = addons
    .filter((addon) => isStatusActive(addon.status))
    .map((addon) => addon.addon_key)
    .filter((addonKey): addonKey is BizzyBeeAddonKey => isAddonKey(addonKey));

  return buildResolvedEntitlements({
    plan,
    source,
    resolutionPath,
    readErrorSafetyDowngrade,
    subscriptionStatus,
    addonKeys,
    rolloutMode,
    override: requestedOverride,
  });
}

export function hasFeature(
  entitlements: WorkspaceEntitlements,
  feature: BizzyBeeFeatureKey,
): boolean {
  return entitlements.features[feature];
}
