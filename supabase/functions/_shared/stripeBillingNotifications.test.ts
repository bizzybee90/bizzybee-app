import { describe, expect, it } from 'vitest';

import { deriveBillingNotification } from './stripeBillingNotifications';

describe('deriveBillingNotification', () => {
  it('sends a started email for new subscriptions', () => {
    const notification = deriveBillingNotification({
      eventType: 'customer.subscription.created',
      previous: null,
      current: {
        planKey: 'starter',
        addonKeys: ['sms_ai'],
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2026-05-01T00:00:00.000Z',
      },
    });

    expect(notification).toEqual({
      kind: 'billing_subscription_started',
      details: ['Plan: Starter', 'Add-ons: SMS AI', 'Status: active'],
    });
  });

  it('sends a cancellation scheduled email when cancel_at_period_end turns on', () => {
    const notification = deriveBillingNotification({
      eventType: 'customer.subscription.updated',
      previous: {
        planKey: 'growth',
        addonKeys: ['ai_phone'],
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2026-05-01T00:00:00.000Z',
      },
      current: {
        planKey: 'growth',
        addonKeys: ['ai_phone'],
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-05-01T00:00:00.000Z',
      },
    });

    expect(notification?.kind).toBe('billing_cancellation_scheduled');
    expect(notification?.details).toContain('Plan: Growth');
    expect(notification?.details).toContain('Add-ons: AI Phone');
  });

  it('returns null when nothing meaningful changed', () => {
    const notification = deriveBillingNotification({
      eventType: 'customer.subscription.updated',
      previous: {
        planKey: 'pro',
        addonKeys: ['ai_phone', 'sms_ai'],
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2026-05-01T00:00:00.000Z',
      },
      current: {
        planKey: 'pro',
        addonKeys: ['sms_ai', 'ai_phone'],
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2026-05-01T00:00:00.000Z',
      },
    });

    expect(notification).toBeNull();
  });

  it('sends a cancelled email for subscription deletions', () => {
    const notification = deriveBillingNotification({
      eventType: 'customer.subscription.deleted',
      previous: {
        planKey: 'starter',
        addonKeys: [],
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-05-01T00:00:00.000Z',
      },
      current: {
        planKey: 'starter',
        addonKeys: [],
        status: 'canceled',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-05-01T00:00:00.000Z',
      },
    });

    expect(notification).toEqual({
      kind: 'billing_subscription_cancelled',
      details: [
        'Plan: Starter',
        'Add-ons: No add-ons',
        'Status: canceled',
        'Access remains active until 01/05/2026',
      ],
    });
  });
});
