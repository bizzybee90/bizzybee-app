CREATE TABLE IF NOT EXISTS public.workspace_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL CHECK (plan_key IN ('connect', 'starter', 'growth', 'pro')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'canceled')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  trial_ends_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_subscriptions_workspace_status
  ON public.workspace_subscriptions(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_workspace_subscriptions_stripe_customer
  ON public.workspace_subscriptions(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_workspace_subscriptions_stripe_subscription
  ON public.workspace_subscriptions(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS public.workspace_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  addon_key TEXT NOT NULL CHECK (addon_key IN ('whatsapp_routing', 'sms_routing', 'whatsapp_ai', 'sms_ai', 'ai_phone')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'canceled')),
  stripe_subscription_item_id TEXT,
  stripe_price_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, addon_key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_addons_workspace_status
  ON public.workspace_addons(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_workspace_addons_stripe_item
  ON public.workspace_addons(stripe_subscription_item_id);

ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_addons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view workspace subscriptions" ON public.workspace_subscriptions;
CREATE POLICY "Users can view workspace subscriptions"
  ON public.workspace_subscriptions
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Service role full access to workspace subscriptions" ON public.workspace_subscriptions;
CREATE POLICY "Service role full access to workspace subscriptions"
  ON public.workspace_subscriptions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can view workspace addons" ON public.workspace_addons;
CREATE POLICY "Users can view workspace addons"
  ON public.workspace_addons
  FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Service role full access to workspace addons" ON public.workspace_addons;
CREATE POLICY "Service role full access to workspace addons"
  ON public.workspace_addons
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_workspace_subscriptions_updated_at ON public.workspace_subscriptions;
CREATE TRIGGER trg_workspace_subscriptions_updated_at
  BEFORE UPDATE ON public.workspace_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_workspace_addons_updated_at ON public.workspace_addons;
CREATE TRIGGER trg_workspace_addons_updated_at
  BEFORE UPDATE ON public.workspace_addons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
