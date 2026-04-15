export type StripeBillingPlanKey = 'connect' | 'starter' | 'growth' | 'pro';
export type StripeBillingAddonKey =
  | 'whatsapp_routing'
  | 'sms_routing'
  | 'whatsapp_ai'
  | 'sms_ai'
  | 'ai_phone';

export type StripeCatalogEntry =
  | {
      objectType: 'plan';
      planKey: StripeBillingPlanKey;
      addonKey: null;
      lookupKey: string;
    }
  | {
      objectType: 'addon';
      planKey: null;
      addonKey: StripeBillingAddonKey;
      lookupKey: string;
    };

const PLAN_LOOKUP_KEYS: Record<StripeBillingPlanKey, string> = {
  connect: 'bizzybee_plan_connect_monthly',
  starter: 'bizzybee_plan_starter_monthly',
  growth: 'bizzybee_plan_growth_monthly',
  pro: 'bizzybee_plan_pro_monthly',
};

const ADDON_LOOKUP_KEYS: Record<StripeBillingAddonKey, string> = {
  whatsapp_routing: 'bizzybee_addon_whatsapp_routing_monthly',
  sms_routing: 'bizzybee_addon_sms_routing_monthly',
  whatsapp_ai: 'bizzybee_addon_whatsapp_ai_monthly',
  sms_ai: 'bizzybee_addon_sms_ai_monthly',
  ai_phone: 'bizzybee_addon_ai_phone_monthly',
};

const PLAN_LABELS: Record<StripeBillingPlanKey, string> = {
  connect: 'Connect',
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
};

const ADDON_LABELS: Record<StripeBillingAddonKey, string> = {
  whatsapp_routing: 'WhatsApp Routing',
  sms_routing: 'SMS Routing',
  whatsapp_ai: 'WhatsApp AI',
  sms_ai: 'SMS AI',
  ai_phone: 'AI Phone',
};

const PLAN_KEYS = Object.keys(PLAN_LOOKUP_KEYS) as StripeBillingPlanKey[];
const ADDON_KEYS = Object.keys(ADDON_LOOKUP_KEYS) as StripeBillingAddonKey[];

export function isStripeBillingPlanKey(
  value: string | null | undefined,
): value is StripeBillingPlanKey {
  return Boolean(value && PLAN_KEYS.includes(value as StripeBillingPlanKey));
}

export function isStripeBillingAddonKey(
  value: string | null | undefined,
): value is StripeBillingAddonKey {
  return Boolean(value && ADDON_KEYS.includes(value as StripeBillingAddonKey));
}

export function getPlanLookupKey(planKey: StripeBillingPlanKey): string {
  return PLAN_LOOKUP_KEYS[planKey];
}

export function getAddonLookupKey(addonKey: StripeBillingAddonKey): string {
  return ADDON_LOOKUP_KEYS[addonKey];
}

export function getStripePlanLabel(planKey: StripeBillingPlanKey): string {
  return PLAN_LABELS[planKey];
}

export function getStripeAddonLabel(addonKey: StripeBillingAddonKey): string {
  return ADDON_LABELS[addonKey];
}

export function getAllStripeLookupKeys(): string[] {
  return [...Object.values(PLAN_LOOKUP_KEYS), ...Object.values(ADDON_LOOKUP_KEYS)];
}

export function resolveStripeCatalogEntry(input: {
  lookupKey?: string | null;
  metadata?: Record<string, string | null | undefined> | null;
}): StripeCatalogEntry | null {
  const lookupKey = input.lookupKey?.trim() || null;
  const metadata = input.metadata ?? null;
  const objectType = metadata?.bizzybee_object_type?.trim() || null;
  const planKey = metadata?.plan_key?.trim() || null;
  const addonKey = metadata?.addon_key?.trim() || null;

  if (objectType === 'plan' && isStripeBillingPlanKey(planKey)) {
    return {
      objectType: 'plan',
      planKey,
      addonKey: null,
      lookupKey: lookupKey || getPlanLookupKey(planKey),
    };
  }

  if (objectType === 'addon' && isStripeBillingAddonKey(addonKey)) {
    return {
      objectType: 'addon',
      planKey: null,
      addonKey,
      lookupKey: lookupKey || getAddonLookupKey(addonKey),
    };
  }

  if (lookupKey) {
    const planEntry = PLAN_KEYS.find((candidate) => getPlanLookupKey(candidate) === lookupKey);
    if (planEntry) {
      return {
        objectType: 'plan',
        planKey: planEntry,
        addonKey: null,
        lookupKey,
      };
    }

    const addonEntry = ADDON_KEYS.find((candidate) => getAddonLookupKey(candidate) === lookupKey);
    if (addonEntry) {
      return {
        objectType: 'addon',
        planKey: null,
        addonKey: addonEntry,
        lookupKey,
      };
    }
  }

  return null;
}
