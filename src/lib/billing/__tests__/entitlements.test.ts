import { describe, expect, it } from 'vitest';

import {
  resolveWorkspaceEntitlements,
  type WorkspaceAddonRow,
  type WorkspaceSubscriptionRow,
} from '../entitlements';

function makeSubscription(
  overrides: Partial<WorkspaceSubscriptionRow> = {},
): WorkspaceSubscriptionRow {
  return {
    id: 'sub_1',
    workspace_id: 'ws_1',
    plan_key: 'growth',
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
    ...overrides,
  };
}

function makeAddon(overrides: Partial<WorkspaceAddonRow> = {}): WorkspaceAddonRow {
  return {
    id: 'addon_1',
    workspace_id: 'ws_1',
    addon_key: 'whatsapp_ai',
    status: 'active',
    stripe_subscription_item_id: null,
    stripe_price_id: null,
    quantity: 1,
    started_at: new Date().toISOString(),
    ended_at: null,
    metadata: {},
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe('resolveWorkspaceEntitlements', () => {
  it('falls back to permissive legacy access when no subscription row exists', () => {
    const entitlements = resolveWorkspaceEntitlements(null, []);

    expect(entitlements.source).toBe('legacy_fallback');
    expect(entitlements.plan).toBe('pro');
    expect(entitlements.canUseAiInbox).toBe(true);
    expect(entitlements.canUseAiPhone).toBe(true);
    expect(entitlements.canUseWhatsAppAi).toBe(true);
  });

  it('resolves plan features and active add-ons from billing rows', () => {
    const entitlements = resolveWorkspaceEntitlements(makeSubscription(), [
      makeAddon({ addon_key: 'whatsapp_ai' }),
      makeAddon({ id: 'addon_2', addon_key: 'ai_phone' }),
    ]);

    expect(entitlements.source).toBe('subscription');
    expect(entitlements.plan).toBe('growth');
    expect(entitlements.canUseAiInbox).toBe(true);
    expect(entitlements.canUseWhatsAppAi).toBe(true);
    expect(entitlements.canUseAiPhone).toBe(true);
    expect(entitlements.limits.emailHistoryImportLimit).toBe(10_000);
    expect(entitlements.limits.includedPhoneMinutes).toBe(100);
  });

  it('does not enable AI add-ons when the subscription is not active', () => {
    const entitlements = resolveWorkspaceEntitlements(makeSubscription({ status: 'past_due' }), [
      makeAddon({ addon_key: 'sms_ai' }),
    ]);

    expect(entitlements.canUseAiInbox).toBe(false);
    expect(entitlements.canUseSmsAi).toBe(false);
    expect(entitlements.canUseAiPhone).toBe(false);
  });

  it('keeps connect tier routing-only behaviour intact', () => {
    const entitlements = resolveWorkspaceEntitlements(makeSubscription({ plan_key: 'connect' }), [
      makeAddon({ addon_key: 'whatsapp_routing' }),
      makeAddon({ id: 'addon_2', addon_key: 'sms_routing' }),
    ]);

    expect(entitlements.canUseAiInbox).toBe(false);
    expect(entitlements.canUseInstagramAi).toBe(false);
    expect(entitlements.canUseWhatsAppRouting).toBe(true);
    expect(entitlements.canUseWhatsAppAi).toBe(false);
    expect(entitlements.canUseSmsRouting).toBe(true);
  });
});
