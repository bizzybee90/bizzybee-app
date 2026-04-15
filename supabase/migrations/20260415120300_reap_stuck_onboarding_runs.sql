-- Phase 0 ops migration: reap stuck runs created during the 401 storm.
--
-- Context (docs/plans/2026-04-15-onboarding-disaster-remediation.md Phase 0):
-- As of the 2026-04-15 audit the live project had 10 `agent_runs` in
-- status='running' with heartbeats older than 9 hours, and 6 `pipeline_runs`
-- in state='running' for 5+ days. These cannot self-heal because:
--   - The supervisor that would flip them has been 401ing on every cron tick
--     (token mismatch, addressed separately in the maintenance window).
--   - start-onboarding-discovery deletes prior rows but never cancels prior
--     agent_runs — so every retry by a user piled on another orphan.
--
-- Safe cutoffs:
--   - agent_runs: 1 hour of heartbeat silence → failed
--   - pipeline_runs: 1 hour since updated_at → failed
-- Both are longer than any legitimate step could take, so this won't kill
-- a real in-flight run.
--
-- This is a one-shot reconciliation. It does not add a recurring cleaner —
-- once Phase 0 auth is fixed the supervisor handles ongoing cleanup.

update public.agent_runs
set
  status = 'failed',
  error_summary = coalesce(error_summary, '{}'::jsonb)
    || jsonb_build_object(
      'reaper', 'phase-0-reap-stuck-runs',
      'reaped_at', now()::text,
      'reason', 'Stale heartbeat > 1h during 401 incident; supervisor could not flip.'
    ),
  completed_at = coalesce(completed_at, now())
where status = 'running'
  and (
    last_heartbeat_at is null
    or last_heartbeat_at < now() - interval '1 hour'
  );

update public.pipeline_runs
set
  state = 'failed',
  last_error = coalesce(
    last_error,
    'Phase-0 reaper: run stale > 1h during 401 incident. Restart from UI.'
  ),
  completed_at = coalesce(completed_at, now())
where state = 'running'
  and (
    updated_at is null
    or updated_at < now() - interval '1 hour'
  );
