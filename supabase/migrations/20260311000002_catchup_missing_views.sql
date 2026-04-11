-- =============================================================================
-- BizzyBee Catch-Up Migration: Missing Views
-- Generated: 2026-03-12
-- Purpose: Creates views referenced in TypeScript types but missing from own DB
-- =============================================================================

BEGIN;
-- =============================================================================
-- 0a. Ensure conversations has pipeline columns (may be missing if earlier migrations partially failed)
-- =============================================================================
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_message_id uuid,
  ADD COLUMN IF NOT EXISTS last_inbound_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_classified_message_id uuid,
  ADD COLUMN IF NOT EXISTS last_classify_enqueued_message_id uuid,
  ADD COLUMN IF NOT EXISTS last_draft_message_id uuid;
-- =============================================================================
-- 0b. Ensure competitor_sites has enrichment columns
-- =============================================================================
ALTER TABLE public.competitor_sites
  ADD COLUMN IF NOT EXISTS quality_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority_tier text DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS is_places_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_place_id text,
  ADD COLUMN IF NOT EXISTS serp_position integer,
  ADD COLUMN IF NOT EXISTS search_query_used text,
  ADD COLUMN IF NOT EXISTS distance_km float,
  ADD COLUMN IF NOT EXISTS reviews_count integer;
-- 0c. Ensure competitor_sites has basic columns from multiple migrations
ALTER TABLE public.competitor_sites
  ADD COLUMN IF NOT EXISTS rating float,
  ADD COLUMN IF NOT EXISTS review_count integer,
  ADD COLUMN IF NOT EXISTS distance_miles float,
  ADD COLUMN IF NOT EXISTS discovery_source text DEFAULT 'google_places',
  ADD COLUMN IF NOT EXISTS discovery_query text,
  ADD COLUMN IF NOT EXISTS match_reason text,
  ADD COLUMN IF NOT EXISTS validation_status text,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz;
-- =============================================================================
-- 1. bb_needs_classification — Conversations needing AI classification
-- =============================================================================
CREATE OR REPLACE VIEW public.bb_needs_classification AS
SELECT
  c.id                                  AS conversation_id,
  c.workspace_id,
  c.channel,
  c.status,
  c.updated_at,
  c.last_classified_message_id,
  c.last_classify_enqueued_message_id,
  (
    SELECT m.id FROM public.messages m
    WHERE m.conversation_id = c.id
      AND m.direction = 'inbound'
    ORDER BY m.created_at DESC
    LIMIT 1
  )                                     AS last_inbound_message_id
FROM public.conversations c
WHERE c.status IN ('new', 'open', 'ai_handling')
  AND (
    c.last_classified_message_id IS DISTINCT FROM c.last_classify_enqueued_message_id
    OR c.last_classified_message_id IS NULL
  );
-- =============================================================================
-- 2. bb_open_incidents — Unresolved pipeline incidents
-- =============================================================================
CREATE OR REPLACE VIEW public.bb_open_incidents AS
SELECT
  pi.id,
  pi.run_id,
  pi.workspace_id,
  pi.scope,
  pi.severity,
  pi.error,
  pi.context,
  pi.created_at
FROM public.pipeline_incidents pi
WHERE pi.resolved_at IS NULL;
-- =============================================================================
-- 3. bb_pipeline_progress — Pipeline run progress with event counts
-- =============================================================================
CREATE OR REPLACE VIEW public.bb_pipeline_progress AS
SELECT
  pr.id                                 AS run_id,
  pr.workspace_id,
  pr.channel,
  pr.config_id,
  pr.state,
  pr.mode,
  pr.started_at,
  pr.completed_at,
  pr.last_heartbeat_at,
  pr.last_error,
  pr.metrics,
  CASE WHEN pr.last_heartbeat_at IS NOT NULL
    THEN age(now(), pr.last_heartbeat_at)
    ELSE NULL
  END                                   AS heartbeat_age,
  -- Event counts from message_events
  COUNT(me.id) FILTER (WHERE true)                          AS total_events,
  COUNT(me.id) FILTER (WHERE me.status = 'received')        AS received_events,
  COUNT(me.id) FILTER (WHERE me.status = 'materialized')    AS materialized_events,
  COUNT(me.id) FILTER (WHERE me.status = 'classified')      AS classified_events,
  COUNT(me.id) FILTER (WHERE me.status = 'decided')         AS decided_events,
  COUNT(me.id) FILTER (WHERE me.status = 'drafted')         AS drafted_events,
  COUNT(me.id) FILTER (WHERE me.status = 'failed')          AS failed_events
FROM public.pipeline_runs pr
LEFT JOIN public.message_events me ON me.run_id = pr.id
GROUP BY pr.id;
-- =============================================================================
-- 4. bb_queue_depths — Message queue depth summary
-- Uses pgmq.bb_queue_visible_count if available; otherwise a simple placeholder
-- The actual queue tables are created by bb_schedule_pipeline_crons
-- =============================================================================
DO $$
BEGIN
  -- Try to create the view using pgmq tables if they exist
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgmq') THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.bb_queue_depths AS
      SELECT unnest(ARRAY['bb_import_jobs','bb_ingest_jobs','bb_classify_jobs','bb_draft_jobs','bb_deadletter_jobs']) AS queue_name,
             0::bigint AS visible_messages
    $view$;
  ELSE
    CREATE OR REPLACE VIEW public.bb_queue_depths AS
    SELECT 'no_pgmq'::text AS queue_name, 0::bigint AS visible_messages WHERE false;
  END IF;
END;
$$;
-- =============================================================================
-- 5. bb_stalled_events — Message events stuck for too long
-- =============================================================================
CREATE OR REPLACE VIEW public.bb_stalled_events AS
SELECT
  me.id,
  me.run_id,
  me.workspace_id,
  me.channel,
  me.config_id,
  me.external_id,
  me.thread_id,
  me.status,
  me.created_at,
  me.updated_at,
  age(now(), me.updated_at) AS age
FROM public.message_events me
WHERE me.status NOT IN ('completed', 'failed', 'archived')
  AND me.updated_at < now() - interval '15 minutes';
-- =============================================================================
-- 6. competitor_market_intelligence — Aggregated competitor research stats
-- =============================================================================
CREATE OR REPLACE VIEW public.competitor_market_intelligence AS
SELECT
  cs.job_id,
  COUNT(*) AS total_competitors,
  COUNT(*) FILTER (WHERE cs.discovery_source = 'google_places') AS from_places,
  COUNT(*) FILTER (WHERE cs.discovery_source = 'serp') AS from_serp,
  COUNT(*) FILTER (WHERE cs.is_places_verified = true) AS verified_count,
  COUNT(*) FILTER (WHERE cs.priority_tier = 'high') AS high_priority,
  COUNT(*) FILTER (WHERE cs.priority_tier = 'medium') AS medium_priority,
  COUNT(*) FILTER (WHERE cs.priority_tier = 'low') AS low_priority,
  AVG(cs.rating) AS avg_rating,
  AVG(cs.review_count) AS avg_reviews,
  AVG(cs.distance_km) AS avg_distance,
  AVG(cs.quality_score) AS avg_quality_score
FROM public.competitor_sites cs
GROUP BY cs.job_id;
-- =============================================================================
-- 7. training_pairs — Paired inbound/outbound messages for voice training
-- =============================================================================
CREATE OR REPLACE VIEW public.training_pairs AS
SELECT
  c.workspace_id,
  c.id AS conversation_id,
  m_in.id AS inbound_id,
  c.title AS subject,
  m_in.body AS customer_text,
  m_out.body AS owner_text,
  EXTRACT(EPOCH FROM (m_out.created_at - m_in.created_at)) / 3600.0 AS response_hours
FROM public.conversations c
JOIN public.messages m_in ON m_in.conversation_id = c.id AND m_in.direction = 'inbound'
JOIN public.messages m_out ON m_out.conversation_id = c.id AND m_out.direction = 'outbound'
  AND m_out.created_at > m_in.created_at
  AND NOT EXISTS (
    SELECT 1 FROM public.messages m_between
    WHERE m_between.conversation_id = c.id
      AND m_between.direction = 'outbound'
      AND m_between.created_at > m_in.created_at
      AND m_between.created_at < m_out.created_at
  );
COMMIT;
