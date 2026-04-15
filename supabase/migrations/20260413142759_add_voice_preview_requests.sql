create table if not exists public.voice_preview_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  voice_id text not null,
  preview_text_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists voice_preview_requests_workspace_created_at_idx
  on public.voice_preview_requests (workspace_id, created_at desc);

create index if not exists voice_preview_requests_user_created_at_idx
  on public.voice_preview_requests (user_id, created_at desc);

alter table public.voice_preview_requests enable row level security;;
