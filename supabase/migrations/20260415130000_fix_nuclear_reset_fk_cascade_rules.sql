-- Repair foreign-key delete rules so workspace-scoped cascades actually work.
--
-- Problem observed 2026-04-15: nuclear-reset failed with a non-2xx because
-- many child tables FK-reference parent tables with NO ACTION/RESTRICT delete
-- rules. In particular message_events.materialized_message_id → messages had
-- 2,671 rows blocking the strict delete of messages on the MAC Cleaning
-- workspace. The same class of bug existed across many FKs throughout the
-- schema — every parent delete that involved any of these child tables would
-- fail with FK violation.
--
-- Design intent: FKs into workspace-scoped lifecycle tables (conversations,
-- messages, customers, faq_database, competitor_*, scraping_jobs) should
-- either CASCADE (when the child has no meaning without the parent) or
-- SET NULL (when the child is a denormalized reference or an audit log
-- that should outlive the parent).
--
-- Classification:
--   CASCADE  = child ownership (pair tables, per-message analyses, per-site
--              competitor rows, etc.) — gone when parent is gone
--   SET NULL = denormalized references + audit logs (message_events,
--              data_access_logs, webhook_logs, audio_transcripts,
--              response_feedback) — keep the row, null out the pointer
--
-- Idempotent: each block drops the existing constraint (if present) and
-- re-adds it with the desired rule. Applying twice is safe.

create or replace function public.bb_repoint_fk(
  p_table text,
  p_column text,
  p_constraint_name text,
  p_ref_table text,
  p_ref_column text,
  p_on_delete text
) returns void
language plpgsql
security definer
as $$
begin
  execute format(
    'alter table public.%I drop constraint if exists %I',
    p_table, p_constraint_name
  );
  execute format(
    'alter table public.%I add constraint %I foreign key (%I) references public.%I(%I) on delete %s',
    p_table, p_constraint_name, p_column, p_ref_table, p_ref_column, p_on_delete
  );
end;
$$;

-- conversation_pairs -> messages + conversations (ownership)
select public.bb_repoint_fk('conversation_pairs', 'inbound_message_id', 'conversation_pairs_inbound_message_id_fkey', 'messages', 'id', 'cascade');
select public.bb_repoint_fk('conversation_pairs', 'outbound_message_id', 'conversation_pairs_outbound_message_id_fkey', 'messages', 'id', 'cascade');
select public.bb_repoint_fk('conversation_pairs', 'conversation_id', 'conversation_pairs_conversation_id_fkey', 'conversations', 'id', 'cascade');

-- email_pairs -> messages + conversations (ownership)
select public.bb_repoint_fk('email_pairs', 'inbound_message_id', 'email_pairs_inbound_message_id_fkey', 'messages', 'id', 'cascade');
select public.bb_repoint_fk('email_pairs', 'outbound_message_id', 'email_pairs_outbound_message_id_fkey', 'messages', 'id', 'cascade');
select public.bb_repoint_fk('email_pairs', 'conversation_id', 'email_pairs_conversation_id_fkey', 'conversations', 'id', 'cascade');

-- Per-message analyses
select public.bb_repoint_fk('ignored_emails', 'inbound_message_id', 'ignored_emails_inbound_message_id_fkey', 'messages', 'id', 'cascade');
select public.bb_repoint_fk('image_analyses', 'message_id', 'image_analyses_message_id_fkey', 'messages', 'id', 'cascade');
select public.bb_repoint_fk('voicemail_transcripts', 'message_id', 'voicemail_transcripts_message_id_fkey', 'messages', 'id', 'cascade');

-- Per-conversation child tables (ownership)
select public.bb_repoint_fk('classification_corrections', 'conversation_id', 'classification_corrections_conversation_id_fkey', 'conversations', 'id', 'cascade');
select public.bb_repoint_fk('correction_examples', 'conversation_id', 'correction_examples_conversation_id_fkey', 'conversations', 'id', 'cascade');
select public.bb_repoint_fk('draft_edits', 'conversation_id', 'draft_edits_conversation_id_fkey', 'conversations', 'id', 'cascade');
select public.bb_repoint_fk('triage_corrections', 'conversation_id', 'triage_corrections_conversation_id_fkey', 'conversations', 'id', 'cascade');
select public.bb_repoint_fk('conversation_refs', 'conversation_id', 'conversation_refs_conversation_id_fkey', 'conversations', 'id', 'cascade');

-- Customer-owned child tables
select public.bb_repoint_fk('customer_identities', 'customer_id', 'customer_identities_customer_id_fkey', 'customers', 'id', 'cascade');
select public.bb_repoint_fk('customer_insights', 'customer_id', 'customer_insights_customer_id_fkey', 'customers', 'id', 'cascade');

-- Competitor cascade chain (all child rows owned by job + site)
select public.bb_repoint_fk('competitor_sites', 'job_id', 'competitor_sites_job_id_fkey', 'competitor_research_jobs', 'id', 'cascade');
select public.bb_repoint_fk('competitor_pages', 'site_id', 'competitor_pages_site_id_fkey', 'competitor_sites', 'id', 'cascade');
select public.bb_repoint_fk('competitor_faq_candidates', 'site_id', 'competitor_faq_candidates_site_id_fkey', 'competitor_sites', 'id', 'cascade');
select public.bb_repoint_fk('competitor_faq_candidates', 'job_id', 'competitor_faq_candidates_job_id_fkey', 'competitor_research_jobs', 'id', 'cascade');
select public.bb_repoint_fk('competitor_faqs_raw', 'site_id', 'competitor_faqs_raw_site_id_fkey', 'competitor_sites', 'id', 'cascade');
select public.bb_repoint_fk('competitor_faqs_raw', 'page_id', 'competitor_faqs_raw_page_id_fkey', 'competitor_pages', 'id', 'cascade');
select public.bb_repoint_fk('competitor_faqs_raw', 'job_id', 'competitor_faqs_raw_job_id_fkey', 'competitor_research_jobs', 'id', 'cascade');
select public.bb_repoint_fk('competitor_faqs_raw', 'duplicate_of', 'competitor_faqs_raw_duplicate_of_fkey', 'competitor_faqs_raw', 'id', 'set null');

-- scraping_jobs -> scraped_pages (ownership)
select public.bb_repoint_fk('scraped_pages', 'job_id', 'scraped_pages_job_id_fkey', 'scraping_jobs', 'id', 'cascade');

-- Denormalised references (SET NULL: keep the event/audit row, null the pointer)
select public.bb_repoint_fk('message_events', 'materialized_message_id', 'message_events_materialized_message_id_fkey', 'messages', 'id', 'set null');
select public.bb_repoint_fk('message_events', 'materialized_conversation_id', 'message_events_materialized_conversation_id_fkey', 'conversations', 'id', 'set null');
select public.bb_repoint_fk('message_events', 'materialized_customer_id', 'message_events_materialized_customer_id_fkey', 'customers', 'id', 'set null');
select public.bb_repoint_fk('response_feedback', 'message_id', 'response_feedback_message_id_fkey', 'messages', 'id', 'set null');
select public.bb_repoint_fk('response_feedback', 'conversation_id', 'response_feedback_conversation_id_fkey', 'conversations', 'id', 'set null');

-- Audit / log tables: SET NULL so audit trail survives the parent delete
select public.bb_repoint_fk('data_access_logs', 'conversation_id', 'data_access_logs_conversation_id_fkey', 'conversations', 'id', 'set null');
select public.bb_repoint_fk('data_access_logs', 'customer_id', 'data_access_logs_customer_id_fkey', 'customers', 'id', 'set null');
select public.bb_repoint_fk('webhook_logs', 'conversation_id', 'webhook_logs_conversation_id_fkey', 'conversations', 'id', 'set null');
select public.bb_repoint_fk('audio_transcripts', 'created_conversation_id', 'audio_transcripts_created_conversation_id_fkey', 'conversations', 'id', 'set null');
select public.bb_repoint_fk('audio_transcripts', 'matched_customer_id', 'audio_transcripts_matched_customer_id_fkey', 'customers', 'id', 'set null');
select public.bb_repoint_fk('data_deletion_requests', 'customer_id', 'data_deletion_requests_customer_id_fkey', 'customers', 'id', 'set null');

-- customers -> conversations: SET NULL (conversation survives the customer record being removed)
select public.bb_repoint_fk('conversations', 'customer_id', 'conversations_customer_id_fkey', 'customers', 'id', 'set null');

-- faq_database denormalised refs - SET NULL (keep competitor row, null the fk to removed faq)
select public.bb_repoint_fk('competitor_faq_candidates', 'merged_into_faq_id', 'competitor_faq_candidates_merged_into_faq_id_fkey', 'faq_database', 'id', 'set null');
select public.bb_repoint_fk('competitor_faqs_raw', 'refined_faq_id', 'competitor_faqs_raw_refined_faq_id_fkey', 'faq_database', 'id', 'set null');

-- Drop the helper - not needed at runtime
drop function public.bb_repoint_fk(text, text, text, text, text, text);
