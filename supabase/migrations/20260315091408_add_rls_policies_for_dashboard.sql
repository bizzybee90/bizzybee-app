
-- ═══════════════════════════════════════
-- LEADS: Authenticated users get full access (dashboard)
-- ═══════════════════════════════════════
CREATE POLICY "Authenticated full access on leads"
  ON public.leads
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Anon can also SELECT leads (needed for views like lead_stats, revenue_pipeline)
CREATE POLICY "Anon can read leads"
  ON public.leads
  FOR SELECT
  TO anon
  USING (true);

-- ═══════════════════════════════════════
-- LEAD_EVENTS: Authenticated users get full access (dashboard)
-- ═══════════════════════════════════════
CREATE POLICY "Authenticated full access on lead_events"
  ON public.lead_events
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Anon can also SELECT events (dashboard views)
CREATE POLICY "Anon can read lead_events"
  ON public.lead_events
  FOR SELECT
  TO anon
  USING (true);

-- ═══════════════════════════════════════
-- DASHBOARD_USERS: Enable RLS, only authenticated can read
-- ═══════════════════════════════════════
ALTER TABLE public.dashboard_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read dashboard_users"
  ON public.dashboard_users
  FOR SELECT
  TO authenticated
  USING (true);
;
