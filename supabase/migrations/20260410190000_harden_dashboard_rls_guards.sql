-- Harden legacy dashboard RLS without assuming the full live schema shape.
-- This only replaces the broad cross-tenant policies when the required columns exist.

DO $$
DECLARE
  leads_exists boolean := to_regclass('public.leads') IS NOT NULL;
  leads_has_workspace_id boolean := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leads'
      AND column_name = 'workspace_id'
  );
BEGIN
  IF leads_exists AND leads_has_workspace_id THEN
    EXECUTE 'ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated full access on leads" ON public.leads';
    EXECUTE 'DROP POLICY IF EXISTS "Workspace members can manage leads" ON public.leads';
    EXECUTE 'DROP POLICY IF EXISTS "Anon can read leads" ON public.leads';

    EXECUTE $policy$
      CREATE POLICY "Workspace members can manage leads"
        ON public.leads
        FOR ALL
        TO authenticated
        USING (
          workspace_id IN (
            SELECT u.workspace_id
            FROM public.users u
            WHERE u.id = auth.uid()
          )
        )
        WITH CHECK (
          workspace_id IN (
            SELECT u.workspace_id
            FROM public.users u
            WHERE u.id = auth.uid()
          )
        )
    $policy$;
  ELSE
    RAISE NOTICE 'Skipping leads RLS hardening: table or workspace_id column not present';
  END IF;
END $$;

DO $$
DECLARE
  lead_events_exists boolean := to_regclass('public.lead_events') IS NOT NULL;
  leads_has_workspace_id boolean := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leads'
      AND column_name = 'workspace_id'
  );
  lead_events_has_workspace_id boolean := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lead_events'
      AND column_name = 'workspace_id'
  );
  lead_events_has_lead_id boolean := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lead_events'
      AND column_name = 'lead_id'
  );
BEGIN
  IF lead_events_exists AND lead_events_has_workspace_id THEN
    EXECUTE 'ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated full access on lead_events" ON public.lead_events';
    EXECUTE 'DROP POLICY IF EXISTS "Workspace members can manage lead_events" ON public.lead_events';
    EXECUTE 'DROP POLICY IF EXISTS "Workspace members can manage lead events" ON public.lead_events';
    EXECUTE 'DROP POLICY IF EXISTS "Anon can read lead_events" ON public.lead_events';

    EXECUTE $policy$
      CREATE POLICY "Workspace members can manage lead events"
        ON public.lead_events
        FOR ALL
        TO authenticated
        USING (
          workspace_id IN (
            SELECT u.workspace_id
            FROM public.users u
            WHERE u.id = auth.uid()
          )
        )
        WITH CHECK (
          workspace_id IN (
            SELECT u.workspace_id
            FROM public.users u
            WHERE u.id = auth.uid()
          )
        )
    $policy$;
  ELSIF lead_events_exists AND lead_events_has_lead_id AND leads_has_workspace_id THEN
    EXECUTE 'ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated full access on lead_events" ON public.lead_events';
    EXECUTE 'DROP POLICY IF EXISTS "Workspace members can manage lead_events" ON public.lead_events';
    EXECUTE 'DROP POLICY IF EXISTS "Workspace members can manage lead events" ON public.lead_events';
    EXECUTE 'DROP POLICY IF EXISTS "Anon can read lead_events" ON public.lead_events';

    EXECUTE $policy$
      CREATE POLICY "Workspace members can manage lead events"
        ON public.lead_events
        FOR ALL
        TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.leads l
            JOIN public.users u
              ON u.workspace_id = l.workspace_id
            WHERE u.id = auth.uid()
              AND l.id = lead_events.lead_id
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1
            FROM public.leads l
            JOIN public.users u
              ON u.workspace_id = l.workspace_id
            WHERE u.id = auth.uid()
              AND l.id = lead_events.lead_id
          )
        )
    $policy$;
  ELSE
    RAISE NOTICE 'Skipping lead_events RLS hardening: table shape did not match expected workspace/lead relation';
  END IF;
END $$;

DO $$
DECLARE
  dashboard_users_exists boolean := to_regclass('public.dashboard_users') IS NOT NULL;
  dashboard_users_has_user_id boolean := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dashboard_users'
      AND column_name = 'user_id'
  );
  dashboard_users_has_id boolean := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dashboard_users'
      AND column_name = 'id'
  );
  dashboard_users_has_workspace_id boolean := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dashboard_users'
      AND column_name = 'workspace_id'
  );
BEGIN
  IF dashboard_users_exists THEN
    EXECUTE 'ALTER TABLE public.dashboard_users ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated can read dashboard_users" ON public.dashboard_users';
    EXECUTE 'DROP POLICY IF EXISTS "Users can read their own dashboard_users row" ON public.dashboard_users';
    EXECUTE 'DROP POLICY IF EXISTS "Workspace members can read dashboard_users" ON public.dashboard_users';

    IF dashboard_users_has_user_id THEN
      EXECUTE $policy$
        CREATE POLICY "Users can read their own dashboard_users row"
          ON public.dashboard_users
          FOR SELECT
          TO authenticated
          USING (user_id = auth.uid())
      $policy$;
    ELSIF dashboard_users_has_id THEN
      EXECUTE $policy$
        CREATE POLICY "Users can read their own dashboard_users row"
          ON public.dashboard_users
          FOR SELECT
          TO authenticated
          USING (id = auth.uid())
      $policy$;
    ELSIF dashboard_users_has_workspace_id THEN
      EXECUTE $policy$
        CREATE POLICY "Workspace members can read dashboard_users"
          ON public.dashboard_users
          FOR SELECT
          TO authenticated
          USING (
            workspace_id IN (
              SELECT u.workspace_id
              FROM public.users u
              WHERE u.id = auth.uid()
            )
          )
      $policy$;
    ELSE
      RAISE NOTICE 'Skipping dashboard_users replacement policy: no user_id, id, or workspace_id column found';
    END IF;
  ELSE
    RAISE NOTICE 'Skipping dashboard_users RLS hardening: table not present';
  END IF;
END $$;
