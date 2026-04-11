export type BillingPlanKey = 'connect' | 'starter' | 'growth' | 'pro';
export type BillingAddonKey =
  | 'whatsapp_routing'
  | 'sms_routing'
  | 'whatsapp_ai'
  | 'sms_ai'
  | 'ai_phone';

export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';

export interface WorkspaceSubscriptionRecord {
  plan_key: BillingPlanKey;
  status: BillingStatus;
}

export interface WorkspaceAddonRecord {
  addon_key: BillingAddonKey;
  status: BillingStatus;
}

const ACTIVE_STATUSES: BillingStatus[] = ['trialing', 'active'];

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
      plan: 'pro' as BillingPlanKey,
      status: 'active' as BillingStatus,
      addons: {
        whatsapp_routing: true,
        sms_routing: true,
        whatsapp_ai: true,
        sms_ai: true,
        ai_phone: true,
      },
    };
  }

  return {
    source: 'subscription' as const,
    plan: subscription.plan_key,
    status: subscription.status,
    addons: {
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
    },
  };
}
