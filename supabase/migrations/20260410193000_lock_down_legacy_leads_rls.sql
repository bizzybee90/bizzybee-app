-- Legacy leads tables are not used by the current BizzyBee app surface.
-- Remove broad authenticated cross-tenant access while preserving any
-- public quote-form insert policy that may still exist.

DO $$
BEGIN
  IF to_regclass('public.leads') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated full access on leads" ON public.leads';
    EXECUTE 'DROP POLICY IF EXISTS "Workspace members can manage leads" ON public.leads';
    EXECUTE 'DROP POLICY IF EXISTS "Anon can read leads" ON public.leads';
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('public.lead_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated full access on lead_events" ON public.lead_events';
    EXECUTE 'DROP POLICY IF EXISTS "Workspace members can manage lead events" ON public.lead_events';
    EXECUTE 'DROP POLICY IF EXISTS "Workspace members can manage lead_events" ON public.lead_events';
    EXECUTE 'DROP POLICY IF EXISTS "Anon can read lead_events" ON public.lead_events';
  END IF;
END $$;
