import type {
  WorkspaceAddonRow,
  WorkspaceSubscriptionRow,
  WorkspaceSubscriptionStatus,
} from './entitlements';
import type { BizzyBeeAddonKey, BizzyBeePlanKey } from './plans';

const FIXTURE_TIMESTAMP = '2026-04-11T12:00:00.000Z';

export interface WorkspaceBillingFixture {
  subscription: WorkspaceSubscriptionRow;
  addons: WorkspaceAddonRow[];
}

export interface WorkspaceSubscriptionFixtureOptions {
  workspaceId?: string;
  plan?: BizzyBeePlanKey;
  status?: WorkspaceSubscriptionStatus;
  overrides?: Partial<WorkspaceSubscriptionRow>;
}

export interface WorkspaceAddonFixtureOptions {
  workspaceId?: string;
  addon?: BizzyBeeAddonKey;
  status?: WorkspaceSubscriptionStatus;
  id?: string;
  overrides?: Partial<WorkspaceAddonRow>;
}

export interface WorkspaceBillingFixtureOptions {
  workspaceId?: string;
  status?: WorkspaceSubscriptionStatus;
  addons?: BizzyBeeAddonKey[];
  subscriptionOverrides?: Partial<WorkspaceSubscriptionRow>;
}

export function createWorkspaceSubscriptionFixture(
  options: WorkspaceSubscriptionFixtureOptions = {},
): WorkspaceSubscriptionRow {
  return {
    id: options.overrides?.id ?? 'sub_fixture',
    workspace_id: options.workspaceId ?? 'ws_fixture',
    plan_key: options.plan ?? 'starter',
    status: options.status ?? 'active',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_price_id: null,
    current_period_start: FIXTURE_TIMESTAMP,
    current_period_end: null,
    cancel_at_period_end: false,
    trial_ends_at: null,
    metadata: {},
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    ...options.overrides,
  };
}

export function createWorkspaceAddonFixture(
  options: WorkspaceAddonFixtureOptions = {},
): WorkspaceAddonRow {
  return {
    id: options.id ?? `addon_${options.addon ?? 'whatsapp_ai'}`,
    workspace_id: options.workspaceId ?? 'ws_fixture',
    addon_key: options.addon ?? 'whatsapp_ai',
    status: options.status ?? 'active',
    stripe_subscription_item_id: null,
    stripe_price_id: null,
    quantity: 1,
    started_at: FIXTURE_TIMESTAMP,
    ended_at: null,
    metadata: {},
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    ...options.overrides,
  };
}

export function createPlanBillingFixture(
  plan: BizzyBeePlanKey,
  options: WorkspaceBillingFixtureOptions = {},
): WorkspaceBillingFixture {
  const workspaceId = options.workspaceId ?? 'ws_fixture';
  const status = options.status ?? 'active';
  const addonKeys = options.addons ?? [];

  return {
    subscription: createWorkspaceSubscriptionFixture({
      workspaceId,
      plan,
      status,
      overrides: options.subscriptionOverrides,
    }),
    addons: addonKeys.map((addonKey, index) =>
      createWorkspaceAddonFixture({
        workspaceId,
        addon: addonKey,
        status,
        id: `addon_${addonKey}_${index + 1}`,
      }),
    ),
  };
}

export function createConnectFixture(
  options: WorkspaceBillingFixtureOptions = {},
): WorkspaceBillingFixture {
  return createPlanBillingFixture('connect', options);
}

export function createStarterFixture(
  options: WorkspaceBillingFixtureOptions = {},
): WorkspaceBillingFixture {
  return createPlanBillingFixture('starter', options);
}

export function createGrowthFixture(
  options: WorkspaceBillingFixtureOptions = {},
): WorkspaceBillingFixture {
  return createPlanBillingFixture('growth', options);
}

export function createProFixture(
  options: WorkspaceBillingFixtureOptions = {},
): WorkspaceBillingFixture {
  return createPlanBillingFixture('pro', options);
}

export function createStarterWithAiPhoneFixture(
  options: WorkspaceBillingFixtureOptions = {},
): WorkspaceBillingFixture {
  return createStarterFixture({
    ...options,
    addons: ['ai_phone'],
  });
}

export function createStarterWithSmsAiFixture(
  options: WorkspaceBillingFixtureOptions = {},
): WorkspaceBillingFixture {
  return createStarterFixture({
    ...options,
    addons: ['sms_ai'],
  });
}

export function createConnectWithSmsRoutingFixture(
  options: WorkspaceBillingFixtureOptions = {},
): WorkspaceBillingFixture {
  return createConnectFixture({
    ...options,
    addons: ['sms_routing'],
  });
}

export function createConnectWithWhatsAppRoutingFixture(
  options: WorkspaceBillingFixtureOptions = {},
): WorkspaceBillingFixture {
  return createConnectFixture({
    ...options,
    addons: ['whatsapp_routing'],
  });
}
