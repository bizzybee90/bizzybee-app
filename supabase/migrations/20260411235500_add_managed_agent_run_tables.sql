create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_key text not null,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled')
  ),
  rollout_mode text not null default 'shadow' check (
    rollout_mode in ('legacy', 'shadow', 'soft', 'hard')
  ),
  trigger_source text,
  legacy_progress_workflow_type text,
  source_job_id uuid references public.scraping_jobs(id) on delete set null,
  initiated_by uuid references public.users(id) on delete set null,
  current_step_key text,
  input_snapshot jsonb not null default '{}'::jsonb,
  output_summary jsonb not null default '{}'::jsonb,
  error_summary jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_runs_workspace_status_idx
  on public.agent_runs (workspace_id, status, created_at desc);
create index if not exists agent_runs_workflow_status_idx
  on public.agent_runs (workflow_key, status, created_at desc);
create table if not exists public.agent_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  step_key text not null,
  attempt integer not null default 1,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'succeeded', 'failed', 'skipped', 'canceled')
  ),
  provider text,
  model text,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_run_steps_run_step_attempt_key unique (run_id, step_key, attempt)
);
create index if not exists agent_run_steps_run_status_idx
  on public.agent_run_steps (run_id, status, created_at asc);
create table if not exists public.agent_run_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  step_id uuid references public.agent_run_steps(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  artifact_type text not null,
  artifact_key text,
  source_url text,
  source_hash text,
  mime_type text,
  content jsonb not null default '{}'::jsonb,
  target_table text,
  target_row_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_run_artifacts_run_type_idx
  on public.agent_run_artifacts (run_id, artifact_type, created_at asc);
create index if not exists agent_run_artifacts_workspace_type_idx
  on public.agent_run_artifacts (workspace_id, artifact_type, created_at desc);
create table if not exists public.agent_run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  step_id uuid references public.agent_run_steps(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  level text not null default 'info' check (
    level in ('debug', 'info', 'warning', 'error')
  ),
  event_type text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists agent_run_events_run_created_idx
  on public.agent_run_events (run_id, created_at asc);
alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;
alter table public.agent_run_artifacts enable row level security;
alter table public.agent_run_events enable row level security;
drop policy if exists "Users can view agent runs for workspace" on public.agent_runs;
create policy "Users can view agent runs for workspace"
  on public.agent_runs
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
drop policy if exists "Users can view agent run steps for workspace" on public.agent_run_steps;
create policy "Users can view agent run steps for workspace"
  on public.agent_run_steps
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
drop policy if exists "Users can view agent run artifacts for workspace" on public.agent_run_artifacts;
create policy "Users can view agent run artifacts for workspace"
  on public.agent_run_artifacts
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
drop policy if exists "Users can view agent run events for workspace" on public.agent_run_events;
create policy "Users can view agent run events for workspace"
  on public.agent_run_events
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
comment on table public.agent_runs is
  'Managed agent workflow runs for selected BizzyBee orchestration paths replacing n8n incrementally.';
comment on table public.agent_run_steps is
  'Per-step execution records for managed agent workflow runs.';
comment on table public.agent_run_artifacts is
  'Intermediate and final artifacts produced by managed agent workflow runs.';
comment on table public.agent_run_events is
  'Append-only event stream for managed agent workflow run observability.';
