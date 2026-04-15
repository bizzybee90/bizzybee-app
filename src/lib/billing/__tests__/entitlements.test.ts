import { describe, expect, it } from 'vitest';

import { getDefaultBillingEnforcementMode, resolveWorkspaceEntitlements } from '../entitlements';
import {
  createConnectFixture,
  createConnectWithSmsRoutingFixture,
  createConnectWithWhatsAppRoutingFixture,
  createGrowthFixture,
  createProFixture,
  createStarterFixture,
  createStarterWithAiPhoneFixture,
  createStarterWithSmsAiFixture,
} from '../fixtures';

describe('resolveWorkspaceEntitlements', () => {
  it('defaults to shadow mode for safe testing', () => {
    expect(getDefaultBillingEnforcementMode()).toBe('shadow');
  });

  it('keeps fallback source explicit while allowing in shadow mode', () => {
    const entitlements = resolveWorkspaceEntitlements(null, [], {
      rolloutMode: 'shadow',
      resolutionPath: 'missing_subscription',
    });

    expect(entitlements.source).toBe('legacy_fallback');
    expect(entitlements.plan).toBe('connect');
    expect(entitlements.rolloutMode).toBe('shadow');
    expect(entitlements.resolution.path).toBe('missing_subscription');
    expect(entitlements.resolution.readErrorSafetyDowngrade).toBe(false);
    expect(entitlements.resolution.intentionalBypass).toBe(false);
    expect(entitlements.decisions.features.analytics.wouldBlock).toBe(true);
    expect(entitlements.decisions.features.analytics.isAllowed).toBe(true);
    expect(entitlements.canUseAiInbox).toBe(true);
    expect(entitlements.canUseAiPhone).toBe(true);
    expect(entitlements.canUseWhatsAppAi).toBe(true);
  });

  it('enforces base access in soft mode while still exposing wouldBlock', () => {
    const { subscription, addons } = createStarterFixture();
    const entitlements = resolveWorkspaceEntitlements(subscription, addons, {
      rolloutMode: 'soft',
    });

    expect(entitlements.rolloutMode).toBe('soft');
    expect(entitlements.canUseAiInbox).toBe(true);
    expect(entitlements.canUseAiPhone).toBe(false);
    expect(entitlements.decisions.capabilities.aiPhone.wouldBlock).toBe(true);
    expect(entitlements.decisions.capabilities.aiPhone.isAllowed).toBe(false);
  });

  it('does not silently fail open when billing reads fail in shadow mode', () => {
    const entitlements = resolveWorkspaceEntitlements(null, [], {
      rolloutMode: 'shadow',
      resolutionPath: 'read_error_fallback',
    });

    expect(entitlements.rolloutMode).toBe('soft');
    expect(entitlements.resolution.path).toBe('read_error_fallback');
    expect(entitlements.resolution.readErrorSafetyDowngrade).toBe(true);
    expect(entitlements.features.analytics).toBe(false);
    expect(entitlements.canUseAiPhone).toBe(false);
  });

  it('resolves plan features and active add-ons from billing rows', () => {
    const { subscription, addons } = createGrowthFixture({
      addons: ['whatsapp_ai', 'ai_phone'],
    });
    const entitlements = resolveWorkspaceEntitlements(subscription, addons, {
      rolloutMode: 'soft',
    });

    expect(entitlements.source).toBe('subscription');
    expect(entitlements.plan).toBe('growth');
    expect(entitlements.canUseAiInbox).toBe(true);
    expect(entitlements.canUseWhatsAppAi).toBe(true);
    expect(entitlements.canUseAiPhone).toBe(true);
    expect(entitlements.limits.emailHistoryImportLimit).toBe(10_000);
    expect(entitlements.limits.includedPhoneMinutes).toBe(100);
  });

  it('does not enable AI add-ons when the subscription is not active', () => {
    const { subscription, addons } = createStarterWithSmsAiFixture({ status: 'past_due' });
    const entitlements = resolveWorkspaceEntitlements(subscription, addons, {
      rolloutMode: 'hard',
    });

    expect(entitlements.canUseAiInbox).toBe(false);
    expect(entitlements.canUseSmsAi).toBe(false);
    expect(entitlements.canUseAiPhone).toBe(false);
  });

  it('supports controlled workspace overrides without enabling hard mode globally', () => {
    const { subscription, addons } = createStarterFixture();
    const entitlements = resolveWorkspaceEntitlements(subscription, addons, {
      rolloutMode: 'soft',
      override: {
        source: 'workspace_override',
        allowPaidFeatures: true,
        note: 'QA workspace bypass',
      },
    });

    expect(entitlements.override.applied).toBe(true);
    expect(entitlements.override.source).toBe('workspace_override');
    expect(entitlements.canUseAiPhone).toBe(true);
    expect(entitlements.decisions.capabilities.aiPhone.wouldBlock).toBe(true);
    expect(entitlements.decisions.capabilities.aiPhone.source).toBe('override');
    expect(entitlements.resolution.intentionalBypass).toBe(true);
    expect(entitlements.limits.emailHistoryImportLimit).toBe(30_000);
  });

  it('keeps connect routing behavior available with paid AI still blocked in hard mode', () => {
    const { subscription, addons } = createConnectWithWhatsAppRoutingFixture();
    const entitlements = resolveWorkspaceEntitlements(subscription, addons, {
      rolloutMode: 'hard',
    });

    expect(entitlements.canUseAiInbox).toBe(false);
    expect(entitlements.canUseInstagramAi).toBe(false);
    expect(entitlements.canUseWhatsAppRouting).toBe(true);
    expect(entitlements.canUseWhatsAppAi).toBe(false);
    expect(entitlements.canUseSmsRouting).toBe(false);
  });

  it('supports plan/add-on simulation overrides for testing combinations', () => {
    const { subscription, addons } = createConnectFixture();
    const entitlements = resolveWorkspaceEntitlements(subscription, addons, {
      rolloutMode: 'soft',
      override: {
        source: 'test_override',
        plan: 'starter',
        addons: { ai_phone: true },
      },
    });

    expect(entitlements.plan).toBe('starter');
    expect(entitlements.canUseAiInbox).toBe(true);
    expect(entitlements.canUseAiPhone).toBe(true);
  });
});

describe('billing fixtures', () => {
  it('builds core plan fixtures and add-on combinations used in dark launch QA', () => {
    const connect = createConnectFixture();
    const starter = createStarterFixture();
    const growth = createGrowthFixture();
    const pro = createProFixture();
    const starterAiPhone = createStarterWithAiPhoneFixture();
    const starterSmsAi = createStarterWithSmsAiFixture();
    const connectSmsRouting = createConnectWithSmsRoutingFixture();
    const connectWhatsAppRouting = createConnectWithWhatsAppRoutingFixture();

    expect(connect.subscription.plan_key).toBe('connect');
    expect(starter.subscription.plan_key).toBe('starter');
    expect(growth.subscription.plan_key).toBe('growth');
    expect(pro.subscription.plan_key).toBe('pro');
    expect(starterAiPhone.addons.some((addon) => addon.addon_key === 'ai_phone')).toBe(true);
    expect(starterSmsAi.addons.some((addon) => addon.addon_key === 'sms_ai')).toBe(true);
    expect(connectSmsRouting.addons.some((addon) => addon.addon_key === 'sms_routing')).toBe(true);
    expect(
      connectWhatsAppRouting.addons.some((addon) => addon.addon_key === 'whatsapp_routing'),
    ).toBe(true);
  });
});
