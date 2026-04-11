-- =============================================================================
-- BizzyBee Catch-Up Migration: RLS Policies for New Tables
-- Generated: 2026-03-12
-- Purpose: Enable RLS and add workspace-scoped policies for all new tables
-- Pattern: Users can only access rows matching their workspace_id
-- =============================================================================

BEGIN;
-- Helper: ensure bb_user_in_workspace function exists
CREATE OR REPLACE FUNCTION public.bb_user_in_workspace(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND workspace_id = p_workspace_id
  );
$$;
-- =============================================================================
-- Enable RLS on all new tables (idempotent)
-- =============================================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'api_usage', 'classification_corrections', 'classification_jobs',
    'conversation_refs', 'customer_identities', 'customer_insights',
    'directory_blocklist', 'documents', 'document_chunks',
    'folder_cursors', 'ground_truth_facts', 'image_analyses',
    'import_jobs', 'knowledge_base_faqs', 'known_senders',
    'message_events', 'n8n_workflow_progress', 'pipeline_incidents',
    'pipeline_job_audit', 'pipeline_locks', 'pipeline_runs',
    'pre_triage_rules', 'scraped_pages', 'scraping_jobs',
    'system_logs', 'voice_drift_log', 'voicemail_transcripts',
    'website_scrape_jobs', 'workspace_credentials'
  ])
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END;
$$;
-- =============================================================================
-- Workspace-scoped SELECT policies
-- Pattern: Users can read their own workspace's data
-- =============================================================================
DO $$
DECLARE
  tbl text;
  pol_name text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'api_usage', 'classification_corrections', 'classification_jobs',
    'conversation_refs', 'customer_identities', 'customer_insights',
    'directory_blocklist', 'documents', 'document_chunks',
    'folder_cursors', 'ground_truth_facts', 'image_analyses',
    'import_jobs', 'knowledge_base_faqs', 'known_senders',
    'message_events', 'n8n_workflow_progress', 'pipeline_incidents',
    'pipeline_job_audit', 'pipeline_locks', 'pipeline_runs',
    'pre_triage_rules', 'scraped_pages', 'scraping_jobs',
    'system_logs', 'voice_drift_log', 'voicemail_transcripts',
    'website_scrape_jobs', 'workspace_credentials'
  ])
  LOOP
    pol_name := tbl || '_workspace_select';
    -- Drop if exists then recreate (idempotent)
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (public.bb_user_in_workspace(workspace_id))',
        pol_name, tbl
      );
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Policy % on % skipped: %', pol_name, tbl, SQLERRM;
    END;
  END LOOP;
END;
$$;
-- =============================================================================
-- Workspace-scoped INSERT/UPDATE/DELETE policies
-- Pattern: Users can modify their own workspace's data
-- =============================================================================
DO $$
DECLARE
  tbl text;
  pol_name text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'api_usage', 'classification_corrections', 'classification_jobs',
    'conversation_refs', 'customer_identities', 'customer_insights',
    'directory_blocklist', 'documents', 'document_chunks',
    'folder_cursors', 'ground_truth_facts', 'image_analyses',
    'import_jobs', 'knowledge_base_faqs', 'known_senders',
    'message_events', 'n8n_workflow_progress', 'pipeline_incidents',
    'pipeline_job_audit', 'pipeline_locks', 'pipeline_runs',
    'pre_triage_rules', 'scraped_pages', 'scraping_jobs',
    'system_logs', 'voice_drift_log', 'voicemail_transcripts',
    'website_scrape_jobs', 'workspace_credentials'
  ])
  LOOP
    pol_name := tbl || '_workspace_all';
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (public.bb_user_in_workspace(workspace_id)) WITH CHECK (public.bb_user_in_workspace(workspace_id))',
        pol_name, tbl
      );
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Policy % on % skipped: %', pol_name, tbl, SQLERRM;
    END;
  END LOOP;
END;
$$;
-- =============================================================================
-- Service role bypass — allows edge functions (service_role) to bypass RLS
-- This is the default Supabase behavior, but make it explicit
-- =============================================================================
DO $$
DECLARE
  tbl text;
  pol_name text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'api_usage', 'classification_corrections', 'classification_jobs',
    'conversation_refs', 'customer_identities', 'customer_insights',
    'directory_blocklist', 'documents', 'document_chunks',
    'folder_cursors', 'ground_truth_facts', 'image_analyses',
    'import_jobs', 'knowledge_base_faqs', 'known_senders',
    'message_events', 'n8n_workflow_progress', 'pipeline_incidents',
    'pipeline_job_audit', 'pipeline_locks', 'pipeline_runs',
    'pre_triage_rules', 'scraped_pages', 'scraping_jobs',
    'system_logs', 'voice_drift_log', 'voicemail_transcripts',
    'website_scrape_jobs', 'workspace_credentials'
  ])
  LOOP
    pol_name := tbl || '_service_role_all';
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        pol_name, tbl
      );
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Service policy % on % skipped: %', pol_name, tbl, SQLERRM;
    END;
  END LOOP;
END;
$$;
-- =============================================================================
-- Special: known_senders global access (is_global = true readable by all)
-- =============================================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS known_senders_global_select ON public.known_senders;
  CREATE POLICY known_senders_global_select ON public.known_senders
    FOR SELECT USING (is_global = true OR public.bb_user_in_workspace(workspace_id));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'known_senders global policy skipped: %', SQLERRM;
END;
$$;
-- =============================================================================
-- Special: document_chunks inherits access from documents table
-- =============================================================================
DO $$
BEGIN
  DROP POLICY IF EXISTS document_chunks_via_document ON public.document_chunks;
  CREATE POLICY document_chunks_via_document ON public.document_chunks
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.id = document_chunks.document_id
          AND public.bb_user_in_workspace(d.workspace_id)
      )
    );
EXCEPTION WHEN others THEN
  RAISE NOTICE 'document_chunks policy skipped: %', SQLERRM;
END;
$$;
COMMIT;
