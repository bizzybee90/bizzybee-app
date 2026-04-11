export type BizzyBeePlanKey = 'connect' | 'starter' | 'growth' | 'pro';

export type BizzyBeeAddonKey =
  | 'whatsapp_routing'
  | 'sms_routing'
  | 'whatsapp_ai'
  | 'sms_ai'
  | 'ai_phone';

export type BizzyBeeFeatureKey =
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

export interface BizzyBeePlanLimits {
  emailHistoryImportLimit: number;
  includedSms: number;
  includedPhoneMinutes: number;
}

export interface BizzyBeePlanDefinition {
  key: BizzyBeePlanKey;
  name: string;
  monthlyPriceGbp: number;
  hero?: boolean;
  tagline: string;
  features: Record<BizzyBeeFeatureKey, boolean>;
  limits: BizzyBeePlanLimits;
  allowedAddons: BizzyBeeAddonKey[];
}

export interface BizzyBeeAddonDefinition {
  key: BizzyBeeAddonKey;
  name: string;
  monthlyPriceGbp: number;
  usageUnit?: 'sms' | 'minute' | 'template_message';
  includedUnits?: number;
  overagePriceGbp?: number;
  availableOnPlans: BizzyBeePlanKey[];
  notes?: string;
}

const FEATURE_SET = {
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
} satisfies Record<BizzyBeeFeatureKey, boolean>;

export const BIZZYBEE_PLANS: Record<BizzyBeePlanKey, BizzyBeePlanDefinition> = {
  connect: {
    key: 'connect',
    name: 'Connect',
    monthlyPriceGbp: 19,
    tagline: 'Unified inbox only. No AI.',
    features: {
      ...FEATURE_SET,
    },
    limits: {
      emailHistoryImportLimit: 0,
      includedSms: 0,
      includedPhoneMinutes: 0,
    },
    allowedAddons: ['whatsapp_routing', 'sms_routing'],
  },
  starter: {
    key: 'starter',
    name: 'Starter',
    monthlyPriceGbp: 49,
    tagline: 'Entry-level AI for small businesses.',
    features: {
      ...FEATURE_SET,
      ai_inbox: true,
      brand_rules: true,
      knowledge_base: true,
    },
    limits: {
      emailHistoryImportLimit: 1_000,
      includedSms: 0,
      includedPhoneMinutes: 0,
    },
    allowedAddons: ['whatsapp_ai', 'sms_ai', 'ai_phone'],
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    monthlyPriceGbp: 149,
    hero: true,
    tagline: 'Full AI customer operations.',
    features: {
      ...FEATURE_SET,
      ai_inbox: true,
      brand_rules: true,
      knowledge_base: true,
      analytics: true,
    },
    limits: {
      emailHistoryImportLimit: 10_000,
      includedSms: 0,
      includedPhoneMinutes: 0,
    },
    allowedAddons: ['whatsapp_ai', 'sms_ai', 'ai_phone'],
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    monthlyPriceGbp: 349,
    tagline: 'High-volume businesses.',
    features: {
      ...FEATURE_SET,
      ai_inbox: true,
      brand_rules: true,
      knowledge_base: true,
      analytics: true,
      advanced_analytics: true,
      priority_support: true,
    },
    limits: {
      emailHistoryImportLimit: 30_000,
      includedSms: 0,
      includedPhoneMinutes: 0,
    },
    allowedAddons: ['whatsapp_ai', 'sms_ai', 'ai_phone'],
  },
};

export const BIZZYBEE_ADDONS: Record<BizzyBeeAddonKey, BizzyBeeAddonDefinition> = {
  whatsapp_routing: {
    key: 'whatsapp_routing',
    name: 'WhatsApp Routing',
    monthlyPriceGbp: 15,
    availableOnPlans: ['connect'],
    notes: 'Connect tier only. No AI replies.',
  },
  sms_routing: {
    key: 'sms_routing',
    name: 'SMS Routing',
    monthlyPriceGbp: 10,
    usageUnit: 'sms',
    overagePriceGbp: 0.06,
    availableOnPlans: ['connect'],
    notes: 'Connect tier only. No AI replies.',
  },
  whatsapp_ai: {
    key: 'whatsapp_ai',
    name: 'WhatsApp AI',
    monthlyPriceGbp: 49,
    usageUnit: 'template_message',
    overagePriceGbp: 0.01,
    availableOnPlans: ['starter', 'growth', 'pro'],
    notes: 'Outbound template charges should be passed through at cost + 1p.',
  },
  sms_ai: {
    key: 'sms_ai',
    name: 'SMS AI',
    monthlyPriceGbp: 29,
    usageUnit: 'sms',
    includedUnits: 50,
    overagePriceGbp: 0.06,
    availableOnPlans: ['starter', 'growth', 'pro'],
  },
  ai_phone: {
    key: 'ai_phone',
    name: 'AI Phone',
    monthlyPriceGbp: 99,
    usageUnit: 'minute',
    includedUnits: 100,
    overagePriceGbp: 0.3,
    availableOnPlans: ['starter', 'growth', 'pro'],
  },
};

export function getPlanDefinition(plan: BizzyBeePlanKey): BizzyBeePlanDefinition {
  return BIZZYBEE_PLANS[plan];
}

export function getAddonDefinition(addon: BizzyBeeAddonKey): BizzyBeeAddonDefinition {
  return BIZZYBEE_ADDONS[addon];
}

export function planIncludesFeature(plan: BizzyBeePlanKey, feature: BizzyBeeFeatureKey): boolean {
  return BIZZYBEE_PLANS[plan].features[feature];
}

export function planAllowsAddon(plan: BizzyBeePlanKey, addon: BizzyBeeAddonKey): boolean {
  return BIZZYBEE_PLANS[plan].allowedAddons.includes(addon);
}

export function getEmailHistoryImportLimit(plan: BizzyBeePlanKey): number {
  return BIZZYBEE_PLANS[plan].limits.emailHistoryImportLimit;
}
