import {
  resolveWorkspaceEntitlements,
  type WorkspaceAddonRow,
  type WorkspaceEntitlements,
  type WorkspaceSubscriptionRow,
} from '@/lib/billing/entitlements';
import type { BizzyBeeAddonKey, BizzyBeePlanKey } from '@/lib/billing/plans';

export type BillingPersonaKey =
  | 'connect'
  | 'starter'
  | 'growth'
  | 'pro'
  | 'starter_ai_phone'
  | 'starter_sms_ai'
  | 'connect_sms_routing';

interface BillingPersonaDefinition {
  plan: BizzyBeePlanKey;
  addons: BizzyBeeAddonKey[];
}

const PERSONA_DEFINITIONS: Record<BillingPersonaKey, BillingPersonaDefinition> = {
  connect: { plan: 'connect', addons: [] },
  starter: { plan: 'starter', addons: [] },
  growth: { plan: 'growth', addons: [] },
  pro: { plan: 'pro', addons: [] },
  starter_ai_phone: { plan: 'starter', addons: ['ai_phone'] },
  starter_sms_ai: { plan: 'starter', addons: ['sms_ai'] },
  connect_sms_routing: { plan: 'connect', addons: ['sms_routing'] },
};

function makeSubscription(plan: BizzyBeePlanKey): WorkspaceSubscriptionRow {
  return {
    id: `sub_${plan}`,
    workspace_id: 'workspace-123',
    plan_key: plan,
    status: 'active',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_price_id: null,
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    trial_ends_at: null,
    metadata: {},
    created_at: null,
    updated_at: null,
  };
}

function makeAddon(addon: BizzyBeeAddonKey): WorkspaceAddonRow {
  return {
    id: `addon_${addon}`,
    workspace_id: 'workspace-123',
    addon_key: addon,
    status: 'active',
    stripe_subscription_item_id: null,
    stripe_price_id: null,
    quantity: 1,
    started_at: new Date('2026-04-11T09:00:00.000Z').toISOString(),
    ended_at: null,
    metadata: {},
    created_at: null,
    updated_at: null,
  };
}

export function resolvePersonaEntitlements(persona: BillingPersonaKey): WorkspaceEntitlements {
  const definition = PERSONA_DEFINITIONS[persona];
  return resolveWorkspaceEntitlements(
    makeSubscription(definition.plan),
    definition.addons.map(makeAddon),
  );
}
