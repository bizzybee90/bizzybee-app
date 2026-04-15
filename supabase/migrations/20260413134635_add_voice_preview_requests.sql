create table if not exists public.voice_preview_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  voice_id text not null,
  preview_text_hash text not null,
  preview_text_length integer not null,
  preview_text_source text not null default 'default' check (
    preview_text_source in ('default', 'custom')
  ),
  status text not null default 'requested' check (
    status in ('requested', 'success', 'failed')
  ),
  response_bytes integer,
  error_message text,
  retry_after_seconds integer,
  created_at timestamptz not null default now()
);

create index if not exists voice_preview_requests_workspace_user_created_idx
  on public.voice_preview_requests (workspace_id, user_id, created_at desc);

create index if not exists voice_preview_requests_workspace_voice_created_idx
  on public.voice_preview_requests (workspace_id, voice_id, created_at desc);

alter table public.voice_preview_requests enable row level security;

drop policy if exists "Users can view voice previews for workspace" on public.voice_preview_requests;
create policy "Users can view voice previews for workspace"
  on public.voice_preview_requests
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));

comment on table public.voice_preview_requests is
  'Audit log and cooldown ledger for ElevenLabs voice previews generated from the BizzyBee UI.';;
