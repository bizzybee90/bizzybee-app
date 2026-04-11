BEGIN;
-- =============================================================================
-- 1. api_usage — Tracks AI/API provider usage, costs, and token consumption
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.api_usage (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id),
  provider      text        NOT NULL,
  function_name text,
  requests      integer     DEFAULT 0,
  tokens_used   bigint      DEFAULT 0,
  cost_estimate numeric,
  created_at    timestamptz DEFAULT now()
);
COMMENT ON TABLE public.api_usage IS 'Tracks AI/API provider usage per workspace — tokens, requests, and estimated cost.';
-- =============================================================================
-- 2. classification_corrections — Human corrections to AI classification
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.classification_corrections (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid        NOT NULL REFERENCES public.workspaces(id),
  email_id                 uuid,
  conversation_id          uuid        REFERENCES public.conversations(id),
  original_category        text,
  corrected_category       text,
  corrected_requires_reply boolean,
  original_text            text,
  sender_email             text,
  subject                  text,
  created_at               timestamptz DEFAULT now()
);
COMMENT ON TABLE public.classification_corrections IS 'Stores human corrections to AI email/message classifications for learning.';
-- =============================================================================
-- 3. classification_jobs — Batch classification job tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.classification_jobs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES public.workspaces(id),
  status              text        NOT NULL DEFAULT 'pending',
  total_to_classify   integer     DEFAULT 0,
  classified_count    integer     DEFAULT 0,
  failed_count        integer     DEFAULT 0,
  retry_count         integer     DEFAULT 0,
  last_processed_id   uuid,
  error_message       text,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.classification_jobs IS 'Tracks batch classification job progress — how many classified, failed, etc.';
-- =============================================================================
-- 4. conversation_refs — Maps external channel thread IDs to internal conversations
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.conversation_refs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL,
  conversation_id     uuid        NOT NULL REFERENCES public.conversations(id),
  channel             text        NOT NULL,
  config_id           uuid        NOT NULL,
  external_thread_id  text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.conversation_refs IS 'Maps external channel thread IDs (e.g. Gmail thread ID) to internal conversation records.';
-- =============================================================================
-- 5. customer_identities — Links customer records to their various contact identifiers
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.customer_identities (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL,
  customer_id           uuid        NOT NULL REFERENCES public.customers(id),
  identifier_type       text        NOT NULL,
  identifier_value      text        NOT NULL,
  identifier_value_norm text        NOT NULL,
  source_channel        text,
  verified              boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.customer_identities IS 'Links a customer record to all their contact identifiers (email, phone, WhatsApp, etc.).';
-- =============================================================================
-- 6. customer_insights — AI-derived insights about individual customers
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.customer_insights (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES public.workspaces(id),
  customer_id           uuid        NOT NULL REFERENCES public.customers(id),
  insight_type          text        NOT NULL,
  insight_text          text        NOT NULL,
  confidence            numeric,
  source_conversations  uuid[],
  expires_at            timestamptz,
  created_at            timestamptz DEFAULT now()
);
COMMENT ON TABLE public.customer_insights IS 'AI-derived behavioural and preference insights about individual customers.';
-- =============================================================================
-- 7. directory_blocklist — Domains to exclude from competitor scraping
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.directory_blocklist (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain     text        NOT NULL,
  reason     text,
  created_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.directory_blocklist IS 'Domains blocked from competitor research scraping (e.g. Yelp, Yell).';
-- =============================================================================
-- 8. documents — Uploaded documents for the knowledge base
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.documents (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id),
  name           text        NOT NULL,
  file_path      text        NOT NULL,
  file_type      text        NOT NULL,
  file_size      bigint,
  page_count     integer,
  extracted_text text,
  error_message  text,
  status         text        DEFAULT 'pending',
  processed_at   timestamptz,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
COMMENT ON TABLE public.documents IS 'Uploaded documents (PDFs, etc.) for knowledge base extraction.';
-- =============================================================================
-- 9. document_chunks — Chunked + embedded segments of uploaded documents
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id),
  document_id  uuid        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index  integer     NOT NULL,
  content      text        NOT NULL,
  page_number  integer,
  embedding    vector(1536),
  created_at   timestamptz DEFAULT now()
);
COMMENT ON TABLE public.document_chunks IS 'Chunked segments of uploaded documents with pgvector embeddings for semantic search.';
-- =============================================================================
-- 10. folder_cursors — Tracks Gmail folder scanning progress during import
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.folder_cursors (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL,
  job_id            uuid        NOT NULL,
  folder_name       text        NOT NULL,
  folder_id         text,
  next_page_token   text,
  emails_found      integer     DEFAULT 0,
  is_complete       boolean     DEFAULT false,
  priority          integer     DEFAULT 0,
  last_processed_at timestamptz,
  created_at        timestamptz DEFAULT now()
);
COMMENT ON TABLE public.folder_cursors IS 'Tracks per-folder scanning cursor during Gmail import, enabling resumable pagination.';
-- =============================================================================
-- 11. ground_truth_facts — Verified factual knowledge about the business
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.ground_truth_facts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id),
  fact_type    text        NOT NULL,
  fact_key     text        NOT NULL,
  fact_value   text        NOT NULL,
  confidence   numeric,
  source_url   text,
  created_at   timestamptz DEFAULT now()
);
COMMENT ON TABLE public.ground_truth_facts IS 'Verified facts about the business (hours, pricing, services) used as grounding for AI responses.';
-- =============================================================================
-- 12. image_analyses — AI analysis results for images attached to messages
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.image_analyses (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL REFERENCES public.workspaces(id),
  message_id         uuid        REFERENCES public.messages(id),
  image_url          text        NOT NULL,
  analysis_type      text        NOT NULL,
  description        text,
  extracted_data     jsonb,
  confidence         numeric,
  suggested_response text,
  processed_at       timestamptz
);
COMMENT ON TABLE public.image_analyses IS 'Stores AI vision analysis results for images attached to inbound messages.';
-- =============================================================================
-- 13. import_jobs — Email import job orchestration
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.import_jobs (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid        NOT NULL REFERENCES public.workspaces(id),
  status                   text        DEFAULT 'pending',
  total_estimated          integer,
  total_scanned            integer     DEFAULT 0,
  total_hydrated           integer     DEFAULT 0,
  total_processed          integer     DEFAULT 0,
  retry_count              integer     DEFAULT 0,
  error_message            text,
  started_at               timestamptz,
  scanning_completed_at    timestamptz,
  hydrating_completed_at   timestamptz,
  completed_at             timestamptz,
  created_at               timestamptz DEFAULT now()
);
COMMENT ON TABLE public.import_jobs IS 'Orchestrates multi-phase email import: scanning, hydrating, processing.';
-- =============================================================================
-- 14. knowledge_base_faqs — FAQ entries in the workspace knowledge base
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.knowledge_base_faqs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES public.workspaces(id),
  question         text        NOT NULL,
  answer           text        NOT NULL,
  source           text        NOT NULL,
  category         text,
  source_url       text,
  source_domain    text,
  embedding        vector(1536),
  is_validated     boolean     DEFAULT false,
  priority         integer     DEFAULT 0,
  validation_notes text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
COMMENT ON TABLE public.knowledge_base_faqs IS 'FAQ entries for the workspace knowledge base, used for RAG-powered AI responses.';
-- =============================================================================
-- 15. known_senders — Pattern-based sender classification rules
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.known_senders (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        REFERENCES public.workspaces(id),
  pattern        text        NOT NULL,
  pattern_type   text        NOT NULL,
  category       text        NOT NULL,
  requires_reply boolean     DEFAULT true,
  is_global      boolean     DEFAULT false,
  created_at     timestamptz DEFAULT now()
);
COMMENT ON TABLE public.known_senders IS 'Pattern-based rules to auto-classify emails by sender (e.g. noreply@ = noise).';
-- =============================================================================
-- 16. message_events — Unified inbound/outbound message event log (pipeline)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.message_events (
  id                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                   uuid        NOT NULL,
  channel                        text        NOT NULL,
  config_id                      uuid        NOT NULL,
  direction                      text        NOT NULL,
  external_id                    text        NOT NULL,
  thread_id                      text        NOT NULL,
  from_identifier                text        NOT NULL,
  to_identifier                  text        NOT NULL,
  from_name                      text,
  subject                        text,
  body                           text,
  body_html                      text,
  metadata                       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  raw_payload                    jsonb,
  status                         text        NOT NULL DEFAULT 'received',
  is_read                        boolean     NOT NULL DEFAULT false,
  run_id                         uuid,
  materialized_conversation_id   uuid        REFERENCES public.conversations(id),
  materialized_customer_id       uuid        REFERENCES public.customers(id),
  materialized_message_id        uuid        REFERENCES public.messages(id),
  last_error                     text,
  "timestamp"                    timestamptz NOT NULL,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.message_events IS 'Unified event log for all inbound/outbound messages across channels — the pipeline source of truth.';
-- Add check constraint for channel values on message_events
DO $$
BEGIN
  ALTER TABLE public.message_events
    ADD CONSTRAINT message_events_channel_check
    CHECK (channel IN ('email', 'whatsapp', 'sms', 'facebook', 'voice', 'webchat'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'message_events_channel_check already exists: %', SQLERRM;
END;
$$;
-- =============================================================================
-- 17. n8n_workflow_progress — Tracks n8n workflow execution progress
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.n8n_workflow_progress (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id),
  workflow_type text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending',
  details       jsonb,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
COMMENT ON TABLE public.n8n_workflow_progress IS 'Tracks execution progress of n8n automation workflows.';
-- =============================================================================
-- 18. pipeline_incidents — Records pipeline processing errors/incidents
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.pipeline_incidents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL,
  run_id       uuid,
  scope        text        NOT NULL,
  severity     text        NOT NULL,
  error        text        NOT NULL,
  context      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.pipeline_incidents IS 'Records pipeline processing incidents/errors for observability and debugging.';
-- =============================================================================
-- 19. pipeline_job_audit — Audit trail for individual pipeline queue jobs
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.pipeline_job_audit (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  run_id       uuid,
  queue_name   text        NOT NULL,
  outcome      text        NOT NULL,
  attempts     integer     NOT NULL DEFAULT 1,
  job_payload  jsonb       NOT NULL,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.pipeline_job_audit IS 'Audit trail for every pipeline queue job — outcome, attempts, errors.';
-- =============================================================================
-- 20. pipeline_locks — Advisory locks preventing concurrent pipeline execution
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.pipeline_locks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id),
  function_name text        NOT NULL,
  locked_by     text,
  locked_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.pipeline_locks IS 'Advisory locks to prevent concurrent pipeline function execution per workspace.';
-- =============================================================================
-- 21. pipeline_runs — Tracks entire pipeline run lifecycle
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL,
  channel           text        NOT NULL,
  mode              text        NOT NULL,
  state             text        NOT NULL DEFAULT 'running',
  config_id         uuid,
  params            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metrics           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_error        text,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.pipeline_runs IS 'Tracks full pipeline run lifecycle — state, metrics, heartbeat, start/end times.';
-- Add check constraint for channel values on pipeline_runs
DO $$
BEGIN
  ALTER TABLE public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_channel_check
    CHECK (channel IN ('email', 'whatsapp', 'sms', 'facebook', 'voice', 'webchat'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pipeline_runs_channel_check already exists: %', SQLERRM;
END;
$$;
-- =============================================================================
-- 22. pre_triage_rules — (Not found in types.ts — creating minimal stub)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.pre_triage_rules (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id),
  rule_name    text        NOT NULL,
  rule_type    text        NOT NULL DEFAULT 'pattern',
  pattern      text,
  action       text        NOT NULL DEFAULT 'skip',
  priority     integer     DEFAULT 0,
  is_active    boolean     DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
COMMENT ON TABLE public.pre_triage_rules IS 'Rules applied before AI triage — e.g. auto-skip known noise patterns. (Stub — not in types.ts.)';
-- =============================================================================
-- 23. scraped_pages — Individual pages scraped during knowledge base building
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.scraped_pages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL,
  job_id           uuid        NOT NULL,
  url              text        NOT NULL,
  title            text,
  page_type        text,
  content_markdown text,
  content_length   integer,
  faqs_extracted   integer     DEFAULT 0,
  status           text        DEFAULT 'pending',
  created_at       timestamptz DEFAULT now()
);
COMMENT ON TABLE public.scraped_pages IS 'Individual web pages scraped during knowledge base / FAQ extraction.';
-- =============================================================================
-- 24. scraping_jobs — Website scraping job orchestration
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.scraping_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES public.workspaces(id),
  job_type          text        NOT NULL DEFAULT 'website',
  website_url       text,
  status            text        DEFAULT 'pending',
  apify_run_id      text,
  apify_dataset_id  text,
  total_pages_found integer     DEFAULT 0,
  pages_processed   integer     DEFAULT 0,
  faqs_found        integer     DEFAULT 0,
  faqs_stored       integer     DEFAULT 0,
  error_message     text,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz DEFAULT now()
);
COMMENT ON TABLE public.scraping_jobs IS 'Tracks website scraping jobs — uses Apify for crawling, extracts FAQs.';
-- =============================================================================
-- 25. system_logs — Application-wide structured logging
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.system_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        REFERENCES public.workspaces(id),
  level         text        NOT NULL DEFAULT 'info',
  message       text        NOT NULL,
  function_name text,
  details       jsonb,
  stack_trace   text,
  created_at    timestamptz DEFAULT now()
);
COMMENT ON TABLE public.system_logs IS 'Application-wide structured log table for debugging and observability.';
-- =============================================================================
-- 26. voice_drift_log — Tracks when writing style drifts from the owner voice
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.voice_drift_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES public.workspaces(id),
  drift_score       numeric     NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'ok',
  emails_sampled    integer,
  traits_changed    jsonb,
  refresh_triggered boolean     NOT NULL DEFAULT false,
  checked_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.voice_drift_log IS 'Records periodic voice-drift checks — how much the AI writing style has drifted from the owner voice profile.';
-- =============================================================================
-- 27. voicemail_transcripts — Transcriptions and analysis of voicemail messages
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.voicemail_transcripts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL REFERENCES public.workspaces(id),
  message_id         uuid        REFERENCES public.messages(id),
  audio_url          text        NOT NULL,
  transcript         text,
  summary            text,
  caller_sentiment   text,
  duration_seconds   integer,
  extracted_info     jsonb,
  suggested_response text,
  processed_at       timestamptz
);
COMMENT ON TABLE public.voicemail_transcripts IS 'Voicemail transcriptions with sentiment analysis and extracted caller info.';
-- =============================================================================
-- 28. website_scrape_jobs — Deep website scraping for knowledge base + FAQs
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.website_scrape_jobs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES public.workspaces(id),
  website_url         text        NOT NULL,
  status              text        DEFAULT 'pending',
  map_job_id          text,
  scrape_job_id       text,
  pages_found         integer     DEFAULT 0,
  pages_scraped       integer     DEFAULT 0,
  pages_extracted     integer     DEFAULT 0,
  faqs_extracted      integer     DEFAULT 0,
  ground_truth_facts  integer     DEFAULT 0,
  business_info       jsonb,
  scraped_pages       jsonb,
  priority_pages      text[],
  search_keywords     text[],
  voice_profile       jsonb,
  error_message       text,
  retry_count         integer     DEFAULT 0,
  started_at          timestamptz,
  completed_at        timestamptz,
  updated_at          timestamptz DEFAULT now()
);
COMMENT ON TABLE public.website_scrape_jobs IS 'Deep website scraping jobs for extracting FAQs, business info, and ground truth facts.';
-- =============================================================================
-- 29. workspace_credentials — OAuth/API credentials per workspace per provider
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.workspace_credentials (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id),
  provider      text        NOT NULL,
  access_token  text,
  refresh_token text,
  updated_at    timestamptz DEFAULT now()
);
COMMENT ON TABLE public.workspace_credentials IS 'Stores OAuth/API credentials per workspace per provider (e.g. Google, Twilio).';
-- =============================================================================
-- 30. training_pairs — This is actually a VIEW in types.ts (no Insert/Update).
--     Created in the views migration (20260311000002). No table needed here.
-- =============================================================================


-- =============================================================================
-- Deferred foreign keys (tables that reference other new tables)
-- =============================================================================

-- pipeline_incidents.run_id -> pipeline_runs.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_incidents_run_id_fkey'
  ) THEN
    ALTER TABLE public.pipeline_incidents
      ADD CONSTRAINT pipeline_incidents_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES public.pipeline_runs(id);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pipeline_incidents_run_id_fkey skipped: %', SQLERRM;
END;
$$;
-- pipeline_job_audit.run_id -> pipeline_runs.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_job_audit_run_id_fkey'
  ) THEN
    ALTER TABLE public.pipeline_job_audit
      ADD CONSTRAINT pipeline_job_audit_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES public.pipeline_runs(id);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pipeline_job_audit_run_id_fkey skipped: %', SQLERRM;
END;
$$;
-- message_events.run_id -> pipeline_runs.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_events_run_id_fkey'
  ) THEN
    ALTER TABLE public.message_events
      ADD CONSTRAINT message_events_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES public.pipeline_runs(id);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'message_events_run_id_fkey skipped: %', SQLERRM;
END;
$$;
-- scraped_pages.job_id -> scraping_jobs.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scraped_pages_job_id_fkey'
  ) THEN
    ALTER TABLE public.scraped_pages
      ADD CONSTRAINT scraped_pages_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.scraping_jobs(id);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'scraped_pages_job_id_fkey skipped: %', SQLERRM;
END;
$$;
-- folder_cursors.job_id -> import_jobs.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'folder_cursors_job_id_fkey'
  ) THEN
    ALTER TABLE public.folder_cursors
      ADD CONSTRAINT folder_cursors_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.import_jobs(id);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'folder_cursors_job_id_fkey skipped: %', SQLERRM;
END;
$$;
-- conversation_refs channel check
DO $$
BEGIN
  ALTER TABLE public.conversation_refs
    ADD CONSTRAINT conversation_refs_channel_check
    CHECK (channel IN ('email', 'whatsapp', 'sms', 'facebook', 'voice', 'webchat'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'conversation_refs_channel_check already exists: %', SQLERRM;
END;
$$;
-- customer_identities identifier_type check
DO $$
BEGIN
  ALTER TABLE public.customer_identities
    ADD CONSTRAINT customer_identities_identifier_type_check
    CHECK (identifier_type IN ('email', 'phone', 'whatsapp', 'facebook', 'webchat', 'other'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'customer_identities_identifier_type_check already exists: %', SQLERRM;
END;
$$;
-- =============================================================================
-- Useful indexes
-- =============================================================================

-- message_events: common lookups
CREATE INDEX IF NOT EXISTS idx_message_events_workspace_status
  ON public.message_events (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_message_events_thread_id
  ON public.message_events (thread_id);
CREATE INDEX IF NOT EXISTS idx_message_events_external_id
  ON public.message_events (external_id);
CREATE INDEX IF NOT EXISTS idx_message_events_run_id
  ON public.message_events (run_id);
-- pipeline_runs: common lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_workspace_state
  ON public.pipeline_runs (workspace_id, state);
-- pipeline_incidents: open incident lookup
CREATE INDEX IF NOT EXISTS idx_pipeline_incidents_workspace_resolved
  ON public.pipeline_incidents (workspace_id, resolved_at);
-- customer_identities: lookup by identifier
CREATE INDEX IF NOT EXISTS idx_customer_identities_norm
  ON public.customer_identities (identifier_value_norm, workspace_id);
-- conversation_refs: lookup by external thread
CREATE INDEX IF NOT EXISTS idx_conversation_refs_external
  ON public.conversation_refs (external_thread_id, workspace_id);
-- document_chunks: similarity search index (ivfflat)
DO $$
BEGIN
  CREATE INDEX idx_document_chunks_embedding
    ON public.document_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'document_chunks embedding index skipped: %', SQLERRM;
END;
$$;
-- knowledge_base_faqs: similarity search index
DO $$
BEGIN
  CREATE INDEX idx_knowledge_base_faqs_embedding
    ON public.knowledge_base_faqs
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'knowledge_base_faqs embedding index skipped: %', SQLERRM;
END;
$$;
-- system_logs: time-based queries
CREATE INDEX IF NOT EXISTS idx_system_logs_created
  ON public.system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_level
  ON public.system_logs (level, created_at DESC);
-- classification_jobs: status lookup
CREATE INDEX IF NOT EXISTS idx_classification_jobs_workspace_status
  ON public.classification_jobs (workspace_id, status);
-- import_jobs: status lookup
CREATE INDEX IF NOT EXISTS idx_import_jobs_workspace_status
  ON public.import_jobs (workspace_id, status);
-- known_senders: pattern matching
CREATE INDEX IF NOT EXISTS idx_known_senders_workspace
  ON public.known_senders (workspace_id);
CREATE INDEX IF NOT EXISTS idx_known_senders_global
  ON public.known_senders (is_global) WHERE is_global = true;
-- customer_insights: unique constraint for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'customer_insights_customer_type_uidx'
  ) THEN
    CREATE UNIQUE INDEX customer_insights_customer_type_uidx
      ON public.customer_insights (customer_id, insight_type);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'customer_insights unique index skipped: %', SQLERRM;
END;
$$;
COMMIT;
