import { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  CreditCard,
  FileText,
  LockKeyhole,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Clock3,
  CircleDollarSign,
  CheckCircle2,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PanelNotice } from './PanelNotice';
import { SettingsSection } from './SettingsSection';
import { useWorkspace } from '@/hooks/useWorkspace';
import {
  BIZZYBEE_ADDONS,
  BIZZYBEE_PLANS,
  getAddonDefinition,
  getPlanDefinition,
  planAllowsAddon,
  type BizzyBeeAddonKey,
  type BizzyBeePlanKey,
} from '@/lib/billing/plans';

const PLAN_ORDER: BizzyBeePlanKey[] = ['connect', 'starter', 'growth', 'pro'];
const ADDON_ORDER: BizzyBeeAddonKey[] = [
  'whatsapp_routing',
  'sms_routing',
  'whatsapp_ai',
  'sms_ai',
  'ai_phone',
];

const FEATURE_LABELS: Record<string, string> = {
  unified_inbox: 'Unified inbox',
  ai_inbox: 'AI replies',
  instagram_dm: 'Instagram DMs',
  facebook_messenger: 'Facebook Messenger',
  auto_categorisation: 'Auto-categorisation',
  brand_rules: 'Brand rules',
  knowledge_base: 'Knowledge base',
  analytics: 'Analytics',
  advanced_analytics: 'Advanced analytics',
  priority_support: 'Priority support',
};

function formatIncludedUnits(addonKey: BizzyBeeAddonKey) {
  const addon = getAddonDefinition(addonKey);

  if (addon.usageUnit === 'sms') {
    return addon.includedUnits ? `${addon.includedUnits} included SMS` : 'No SMS included';
  }

  if (addon.usageUnit === 'minute') {
    return addon.includedUnits ? `${addon.includedUnits} included minutes` : 'No minutes included';
  }

  if (addon.usageUnit === 'template_message') {
    return addon.includedUnits ? `${addon.includedUnits} included templates` : 'Usage-based only';
  }

  return 'Standalone add-on';
}

export function BillingPanel() {
  const { workspace, entitlements } = useWorkspace();
  const { toast } = useToast();
  const activePlanKey = entitlements?.plan;
  const activePlan = activePlanKey ? getPlanDefinition(activePlanKey) : null;
  const activeAddonKeys = (
    Object.entries(entitlements?.addons ?? {}) as Array<[BizzyBeeAddonKey, boolean]>
  )
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  const hasSyncedBilling = entitlements?.source === 'subscription';
  const recommendedPlanKey: BizzyBeePlanKey =
    hasSyncedBilling && activePlanKey ? activePlanKey : 'starter';
  const [draftPlanKey, setDraftPlanKey] = useState<BizzyBeePlanKey>(recommendedPlanKey);
  const [draftAddonKeys, setDraftAddonKeys] = useState<BizzyBeeAddonKey[]>([]);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [portalPending, setPortalPending] = useState(false);

  const activePlanName = activePlan?.name ?? 'No live subscription connected';
  const activeStatus = entitlements?.subscriptionStatus ?? 'not connected';
  const activeStatusLabel = entitlements ? activeStatus.replace('_', ' ') : 'not connected';

  const currentAddons = activeAddonKeys.length
    ? activeAddonKeys.map((addonKey) => getAddonDefinition(addonKey))
    : [];

  const currentPlanFeatures = activePlan?.features
    ? Object.entries(activePlan.features)
        .filter(([, enabled]) => enabled)
        .map(([featureKey]) => FEATURE_LABELS[featureKey] ?? featureKey)
    : [];
  const draftPlan = getPlanDefinition(draftPlanKey);
  const selectedDraftAddons = useMemo(
    () => draftAddonKeys.map((addonKey) => getAddonDefinition(addonKey)),
    [draftAddonKeys],
  );

  useEffect(() => {
    if (!hasSyncedBilling || !activePlanKey) {
      return;
    }

    setDraftPlanKey(activePlanKey);
    setDraftAddonKeys(
      activeAddonKeys.filter((addonKey) => planAllowsAddon(activePlanKey, addonKey)),
    );
  }, [activeAddonKeys, activePlanKey, hasSyncedBilling]);

  const selectDraftPlan = (planKey: BizzyBeePlanKey) => {
    setDraftPlanKey(planKey);
    setDraftAddonKeys((current) =>
      current.filter((addonKey) => planAllowsAddon(planKey, addonKey)),
    );
  };

  const toggleDraftAddon = (addonKey: BizzyBeeAddonKey) => {
    if (!planAllowsAddon(draftPlanKey, addonKey)) {
      return;
    }

    setDraftAddonKeys((current) =>
      current.includes(addonKey)
        ? current.filter((value) => value !== addonKey)
        : [...current, addonKey],
    );
  };

  const launchCheckout = async () => {
    if (!workspace?.id || checkoutPending) {
      return;
    }

    setCheckoutPending(true);
    try {
      const successUrl = `${window.location.origin}/settings?category=billing&checkout=success`;
      const cancelUrl = `${window.location.origin}/settings?category=billing&checkout=cancelled`;
      const { data, error } = await supabase.functions.invoke('stripe-create-checkout-session', {
        body: {
          workspace_id: workspace.id,
          plan_key: draftPlanKey,
          addon_keys: draftAddonKeys,
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
      });

      if (error) {
        throw error;
      }

      const checkoutUrl = typeof data?.url === 'string' ? data.url : null;
      if (!checkoutUrl) {
        throw new Error('Stripe did not return a checkout URL');
      }

      window.location.assign(checkoutUrl);
    } catch (error) {
      toast({
        title: 'Unable to open Stripe checkout',
        description:
          error instanceof Error ? error.message : 'Try again once billing env is ready.',
        variant: 'destructive',
      });
    } finally {
      setCheckoutPending(false);
    }
  };

  const openPortal = async () => {
    if (!workspace?.id || portalPending) {
      return;
    }

    setPortalPending(true);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-create-portal-session', {
        body: {
          workspace_id: workspace.id,
          return_url: `${window.location.origin}/settings?category=billing`,
        },
      });

      if (error) {
        throw error;
      }

      const portalUrl = typeof data?.url === 'string' ? data.url : null;
      if (!portalUrl) {
        throw new Error('Stripe did not return a portal URL');
      }

      window.location.assign(portalUrl);
    } catch (error) {
      toast({
        title: 'Unable to open billing portal',
        description:
          error instanceof Error
            ? error.message
            : 'Complete checkout first so BizzyBee can sync a Stripe customer.',
        variant: 'destructive',
      });
    } finally {
      setPortalPending(false);
    }
  };

  if (!workspace?.id) {
    return (
      <PanelNotice
        icon={CreditCard}
        title="Finish workspace setup before configuring billing"
        description="BizzyBee needs an active workspace before it can show plan state, add-ons, invoices, or portal access."
        actionLabel="Open onboarding"
        actionTo="/onboarding?reset=true"
      />
    );
  }

  return (
    <div className="space-y-4">
      <PanelNotice
        icon={BadgeDollarSign}
        title="Billing is moving from pricing model to self-serve SaaS"
        description="BizzyBee now has Stripe-safe checkout, portal access, webhook sync, and the first lifecycle billing emails wired. The remaining work is proving the full billing flow end to end and tightening customer-facing billing states."
      />

      <Card className="border-[0.5px] border-bb-border bg-bb-white">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-[15px]">Current billing state</CardTitle>
            <Badge variant="outline">Workspace aware</Badge>
            {entitlements ? <Badge variant="secondary">{activeStatusLabel}</Badge> : null}
          </div>
          <CardDescription>
            This is the state BizzyBee can already reason about. The self-serve billing actions now
            sync through Stripe test mode, but still need full end-to-end proof before launch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-bb-border bg-bb-cream p-4">
              <p className="text-xs uppercase tracking-[0.12em] text-bb-warm-gray">Plan</p>
              <div className="mt-2 flex items-center gap-2">
                <h3 className="text-base font-semibold text-bb-text">{activePlanName}</h3>
                {activePlan ? (
                  <Badge variant="outline">Current</Badge>
                ) : (
                  <Badge variant="outline">Not synced</Badge>
                )}
              </div>
              {activePlan ? (
                <p className="mt-1 text-sm text-bb-warm-gray">
                  £{activePlan.monthlyPriceGbp}/month · {activePlan.tagline}
                </p>
              ) : (
                <p className="mt-1 text-sm text-bb-warm-gray">
                  No live Stripe subscription row is attached to this workspace yet.
                </p>
              )}
              {currentPlanFeatures.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {currentPlanFeatures.slice(0, 6).map((feature) => (
                    <Badge key={feature} variant="secondary">
                      {feature}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-bb-border bg-bb-cream p-4">
              <p className="text-xs uppercase tracking-[0.12em] text-bb-warm-gray">Add-ons</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {currentAddons.length ? (
                  currentAddons.map((addon) => (
                    <Badge key={addon.key} variant="secondary">
                      {addon.name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-bb-warm-gray">No add-ons are synced yet.</span>
                )}
              </div>
              <p className="mt-2 text-sm text-bb-warm-gray">
                {currentAddons.length
                  ? 'These are the add-ons currently represented in the entitlement state.'
                  : 'Add-ons will appear here once billing sync is wired up.'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <SettingsSection
        title="Plans"
        description="Pricing tiers defined in the product model"
        defaultOpen
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {PLAN_ORDER.map((planKey) => {
            const plan = BIZZYBEE_PLANS[planKey];
            const isCurrent = activePlanKey === planKey;
            const enabledFeatures = Object.entries(plan.features)
              .filter(([, enabled]) => enabled)
              .map(([featureKey]) => FEATURE_LABELS[featureKey] ?? featureKey)
              .slice(0, 5);

            return (
              <Card
                key={plan.key}
                className={`border-[0.5px] ${isCurrent ? 'border-bb-gold/40 bg-bb-gold/5' : 'border-bb-border bg-bb-white'}`}
              >
                <CardHeader className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-[15px]">{plan.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      {plan.hero ? <Badge>Hero</Badge> : null}
                      {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                    </div>
                  </div>
                  <CardDescription>{plan.tagline}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-bb-warm-gray">
                        Monthly price
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-bb-text">
                        £{plan.monthlyPriceGbp}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {plan.allowedAddons.length} add-on{plan.allowedAddons.length === 1 ? '' : 's'}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.12em] text-bb-warm-gray">
                      Included capabilities
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {enabledFeatures.map((feature) => (
                        <Badge key={feature} variant="secondary">
                          {feature}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-bb-border bg-bb-linen/60 p-3 text-sm text-bb-warm-gray">
                    <p>
                      Email import: {plan.limits.emailHistoryImportLimit.toLocaleString()} messages
                    </p>
                    <p>Included SMS: {plan.limits.includedSms}</p>
                    <p>Included phone minutes: {plan.limits.includedPhoneMinutes}</p>
                  </div>

                  <Button
                    variant={
                      isCurrent ? 'secondary' : draftPlanKey === plan.key ? 'secondary' : 'outline'
                    }
                    onClick={() => selectDraftPlan(plan.key)}
                    disabled={checkoutPending || portalPending}
                  >
                    {isCurrent && hasSyncedBilling
                      ? 'Current live plan'
                      : draftPlanKey === plan.key
                        ? 'Selected for checkout'
                        : 'Choose this plan'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Add-ons" description="Extra channels and usage-based upgrades">
        <div className="grid gap-3 lg:grid-cols-2">
          {ADDON_ORDER.map((addonKey) => {
            const addon = BIZZYBEE_ADDONS[addonKey];
            const active = Boolean(entitlements?.addons?.[addonKey]);
            const available = planAllowsAddon(activePlanKey ?? 'connect', addonKey);
            const selectedForCheckout = draftAddonKeys.includes(addonKey);
            const availableOnDraftPlan = planAllowsAddon(draftPlanKey, addonKey);

            return (
              <Card
                key={addon.key}
                className={`border-[0.5px] ${active ? 'border-bb-gold/40 bg-bb-gold/5' : 'border-bb-border bg-bb-white'}`}
              >
                <CardHeader className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-[15px]">{addon.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      {active ? <Badge variant="secondary">Active</Badge> : null}
                      {available ? (
                        <Badge variant="outline">Available on plan</Badge>
                      ) : (
                        <Badge variant="outline">Upgrade path</Badge>
                      )}
                    </div>
                  </div>
                  <CardDescription>
                    {addon.notes ?? 'A priced add-on tied to the BizzyBee pricing model.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-bb-warm-gray">
                        Monthly price
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-bb-text">
                        £{addon.monthlyPriceGbp}
                      </p>
                    </div>
                    <Badge variant="outline">{formatIncludedUnits(addonKey)}</Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {addon.availableOnPlans.map((planKey) => (
                      <Badge key={planKey} variant="secondary">
                        {BIZZYBEE_PLANS[planKey].name}
                      </Badge>
                    ))}
                  </div>

                  {addon.overagePriceGbp ? (
                    <p className="text-sm text-bb-warm-gray">
                      Overages: £{addon.overagePriceGbp.toFixed(2)} per usage unit.
                    </p>
                  ) : null}

                  <Button
                    variant={selectedForCheckout ? 'secondary' : 'outline'}
                    disabled={!availableOnDraftPlan || checkoutPending || portalPending}
                    onClick={() => toggleDraftAddon(addonKey)}
                  >
                    {selectedForCheckout
                      ? 'Included in checkout'
                      : availableOnDraftPlan
                        ? 'Add to checkout'
                        : 'Requires a different plan'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Checkout actions"
        description="First self-serve billing actions, ready for Stripe account hookup"
      >
        <Card className="border-[0.5px] border-bb-border bg-bb-white">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-[15px]">Draft Stripe checkout</CardTitle>
              <Badge variant="outline">{draftPlan.name}</Badge>
              {selectedDraftAddons.length ? (
                <Badge variant="secondary">{selectedDraftAddons.length} add-ons selected</Badge>
              ) : null}
            </div>
            <CardDescription>
              This launches hosted Stripe checkout for the selected plan and add-ons. It becomes
              fully live as soon as the BizzyBee Stripe test account is connected.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-bb-border bg-bb-cream p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{draftPlan.name}</Badge>
                <span className="text-sm text-bb-warm-gray">
                  £{draftPlan.monthlyPriceGbp}/month
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedDraftAddons.length ? (
                  selectedDraftAddons.map((addon) => (
                    <Badge key={addon.key} variant="outline">
                      {addon.name} · £{addon.monthlyPriceGbp}/month
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-bb-warm-gray">
                    No add-ons selected for this checkout.
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={launchCheckout} disabled={checkoutPending || portalPending}>
                {checkoutPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-2 h-4 w-4" />
                )}
                {hasSyncedBilling ? 'Start plan change checkout' : 'Start checkout'}
              </Button>
              <Button
                variant="outline"
                onClick={openPortal}
                disabled={!hasSyncedBilling || checkoutPending || portalPending}
              >
                {portalPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LockKeyhole className="mr-2 h-4 w-4" />
                )}
                Open customer portal
              </Button>
            </div>
          </CardContent>
        </Card>
      </SettingsSection>

      <SettingsSection
        title="Invoices & portal"
        description="Customer billing surfaces waiting for Stripe"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="border-[0.5px] border-bb-border bg-bb-white">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-4 w-4 text-bb-gold" />
                <CardTitle className="text-[15px]">Invoices</CardTitle>
              </div>
              <CardDescription>
                Invoice history will show here once Stripe billing sync is connected.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-dashed border-bb-border bg-bb-linen/60 p-4 text-sm text-bb-warm-gray">
                No invoice feed is connected yet. Stripe webhook sync will populate this section
                later.
              </div>
              <div className="flex items-center gap-2 text-sm text-bb-warm-gray">
                <Clock3 className="h-4 w-4" />
                Payment receipts, retries, and renewal notices are still architecture-only.
              </div>
            </CardContent>
          </Card>

          <Card className="border-[0.5px] border-bb-border bg-bb-white">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-bb-gold" />
                <CardTitle className="text-[15px]">Customer portal</CardTitle>
              </div>
              <CardDescription>
                Plan changes, payment methods, and billing updates will live here once portal access
                is wired.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-dashed border-bb-border bg-bb-linen/60 p-4 text-sm text-bb-warm-gray">
                The portal action is now wired, but it still depends on a synced Stripe customer and
                the final webhook/account setup.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={openPortal}
                  disabled={!hasSyncedBilling || checkoutPending || portalPending}
                >
                  {portalPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LockKeyhole className="mr-2 h-4 w-4" />
                  )}
                  Open Stripe portal
                </Button>
                <Button variant="secondary" disabled>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Invoice feed pending
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </SettingsSection>

      <Card className="border-[0.5px] border-bb-border bg-bb-linen/80">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-bb-white p-2 text-bb-gold shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-bb-text">Billing launch checklist</p>
              <p className="mt-1 text-sm text-bb-warm-gray">
                Add Stripe checkout, webhook sync, and customer portal wiring before telling
                customers to self-serve billing. Until then, this area is a truthful pricing and
                entitlements dashboard.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Plan model ready
            </Badge>
            <Badge variant="outline">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Add-on model ready
            </Badge>
            <Badge variant="outline">
              <FileText className="mr-1 h-3 w-3" />
              Invoices pending
            </Badge>
            <Badge variant="outline">
              <CircleDollarSign className="mr-1 h-3 w-3" />
              Portal pending
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
