import type { StripeBillingAddonKey, StripeBillingPlanKey } from './stripeCatalog.ts';
import { getStripeAddonLabel, getStripePlanLabel } from './stripeCatalog.ts';
import type { TransactionalEmailKind } from './resend.ts';

export interface BillingSnapshot {
  planKey: StripeBillingPlanKey;
  addonKeys: StripeBillingAddonKey[];
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: string | null;
}

export interface BillingNotification {
  kind: Extract<
    TransactionalEmailKind,
    | 'billing_subscription_started'
    | 'billing_subscription_updated'
    | 'billing_cancellation_scheduled'
    | 'billing_subscription_cancelled'
  >;
  details: string[];
}

function formatAddonSummary(addonKeys: StripeBillingAddonKey[]): string {
  if (!addonKeys.length) {
    return 'No add-ons';
  }

  return addonKeys.map((addonKey) => getStripeAddonLabel(addonKey)).join(', ');
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function buildSummaryDetails(snapshot: BillingSnapshot): string[] {
  const details = [
    `Plan: ${getStripePlanLabel(snapshot.planKey)}`,
    `Add-ons: ${formatAddonSummary(snapshot.addonKeys)}`,
    `Status: ${formatStatus(snapshot.status)}`,
  ];

  if (snapshot.cancelAtPeriodEnd && snapshot.currentPeriodEnd) {
    details.push(
      `Access remains active until ${new Date(snapshot.currentPeriodEnd).toLocaleDateString('en-GB')}`,
    );
  }

  return details;
}

function equalAddonSets(left: StripeBillingAddonKey[], right: StripeBillingAddonKey[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

export function deriveBillingNotification(params: {
  eventType: string;
  previous: BillingSnapshot | null;
  current: BillingSnapshot;
}): BillingNotification | null {
  const { eventType, previous, current } = params;

  if (eventType === 'customer.subscription.created') {
    return {
      kind: 'billing_subscription_started',
      details: buildSummaryDetails(current),
    };
  }

  if (eventType === 'customer.subscription.deleted') {
    return {
      kind: 'billing_subscription_cancelled',
      details: buildSummaryDetails(current),
    };
  }

  if (eventType !== 'customer.subscription.updated') {
    return null;
  }

  if (!previous) {
    return {
      kind: 'billing_subscription_started',
      details: buildSummaryDetails(current),
    };
  }

  if (current.cancelAtPeriodEnd && !previous.cancelAtPeriodEnd) {
    return {
      kind: 'billing_cancellation_scheduled',
      details: buildSummaryDetails(current),
    };
  }

  const changed =
    previous.planKey !== current.planKey ||
    previous.status !== current.status ||
    previous.cancelAtPeriodEnd !== current.cancelAtPeriodEnd ||
    previous.currentPeriodEnd !== current.currentPeriodEnd ||
    !equalAddonSets(previous.addonKeys, current.addonKeys);

  if (!changed) {
    return null;
  }

  return {
    kind: 'billing_subscription_updated',
    details: buildSummaryDetails(current),
  };
}
