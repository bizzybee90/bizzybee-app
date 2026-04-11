import type { Database } from '@/integrations/supabase/types';
import {
  BIZZYBEE_ADDONS,
  BIZZYBEE_PLANS,
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

export interface WorkspaceEntitlements {
  source: 'subscription' | 'legacy_fallback';
  plan: BizzyBeePlanKey;
  subscriptionStatus: WorkspaceSubscriptionStatus;
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

const ACTIVE_STATUSES: WorkspaceSubscriptionStatus[] = ['trialing', 'active'];

function isStatusActive(status: string | null | undefined): status is WorkspaceSubscriptionStatus {
  return Boolean(status && ACTIVE_STATUSES.includes(status as WorkspaceSubscriptionStatus));
}

function buildAddonMap(
  activeAddons: Iterable<BizzyBeeAddonKey>,
): Record<BizzyBeeAddonKey, boolean> {
  const addonSet = new Set(activeAddons);
  return {
    whatsapp_routing: addonSet.has('whatsapp_routing'),
    sms_routing: addonSet.has('sms_routing'),
    whatsapp_ai: addonSet.has('whatsapp_ai'),
    sms_ai: addonSet.has('sms_ai'),
    ai_phone: addonSet.has('ai_phone'),
  };
}

function buildResolvedEntitlements(
  plan: BizzyBeePlanKey,
  subscriptionStatus: WorkspaceSubscriptionStatus,
  addonKeys: Iterable<BizzyBeeAddonKey>,
  source: WorkspaceEntitlements['source'],
): WorkspaceEntitlements {
  const planDef = BIZZYBEE_PLANS[plan];
  const addons = buildAddonMap(addonKeys);
  const includedSms = addons.sms_ai ? (BIZZYBEE_ADDONS.sms_ai.includedUnits ?? 0) : 0;
  const includedPhoneMinutes = addons.ai_phone ? (BIZZYBEE_ADDONS.ai_phone.includedUnits ?? 0) : 0;
  const aiEnabled = planDef.features.ai_inbox && isStatusActive(subscriptionStatus);

  return {
    source,
    plan,
    subscriptionStatus,
    addons,
    features: { ...planDef.features },
    limits: {
      emailHistoryImportLimit: planDef.limits.emailHistoryImportLimit,
      includedSms,
      includedPhoneMinutes,
    },
    canUseAiInbox: aiEnabled,
    canUseInstagramAi: planDef.features.instagram_dm && aiEnabled,
    canUseFacebookAi: planDef.features.facebook_messenger && aiEnabled,
    canUseWhatsAppAi: addons.whatsapp_ai && aiEnabled,
    canUseWhatsAppRouting: addons.whatsapp_routing || addons.whatsapp_ai,
    canUseSmsAi: addons.sms_ai && aiEnabled,
    canUseSmsRouting: addons.sms_routing || addons.sms_ai,
    canUseAiPhone: addons.ai_phone && isStatusActive(subscriptionStatus),
  };
}

export function resolveWorkspaceEntitlements(
  subscription: WorkspaceSubscriptionRow | null,
  addons: WorkspaceAddonRow[],
): WorkspaceEntitlements {
  if (!subscription) {
    return buildResolvedEntitlements(
      'pro',
      'active',
      Object.keys(BIZZYBEE_ADDONS) as BizzyBeeAddonKey[],
      'legacy_fallback',
    );
  }

  const addonKeys = addons
    .filter((addon) => isStatusActive(addon.status))
    .map((addon) => addon.addon_key as BizzyBeeAddonKey)
    .filter((addonKey) => addonKey in BIZZYBEE_ADDONS);

  return buildResolvedEntitlements(
    subscription.plan_key as BizzyBeePlanKey,
    subscription.status as WorkspaceSubscriptionStatus,
    addonKeys,
    'subscription',
  );
}

export function hasFeature(
  entitlements: WorkspaceEntitlements,
  feature: BizzyBeeFeatureKey,
): boolean {
  return entitlements.features[feature];
}
