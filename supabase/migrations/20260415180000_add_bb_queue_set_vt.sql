-- bb_queue_set_vt: wrapper RPC for pgmq.set_vt used by the pipeline workers'
-- heartbeat to keep an in-flight message's visibility timeout fresh while the
-- owning worker is still doing long-running work (e.g. fetch_pages Apify loop
-- in pipeline-worker-onboarding-faq). Without this, pgmq's default 180s VT
-- can expire mid-iteration, causing duplicate delivery and duplicate Apify
-- runs.
--
-- Style mirrors bb_queue_delete / bb_queue_archive: security definer, fixed
-- search_path, boolean return. pgmq.set_vt returns SETOF pgmq.message_record,
-- so we wrap it with EXISTS() to collapse to a boolean "did it apply?".
create or replace function public.bb_queue_set_vt(
  queue_name text,
  msg_id bigint,
  vt_seconds integer
)
returns boolean
language sql
security definer
set search_path = public, pgmq, pg_catalog
as $$
  select exists (
    select 1 from pgmq.set_vt(queue_name, msg_id, greatest(vt_seconds, 1))
  );
$$;

revoke all on function public.bb_queue_set_vt(text, bigint, integer) from public;
grant execute on function public.bb_queue_set_vt(text, bigint, integer) to service_role;

comment on function public.bb_queue_set_vt(text, bigint, integer) is
  'Extends a pgmq message visibility timeout. Called periodically by edge-function workers via _shared/pgmq-heartbeat.ts to prevent duplicate delivery during long-running steps.';
