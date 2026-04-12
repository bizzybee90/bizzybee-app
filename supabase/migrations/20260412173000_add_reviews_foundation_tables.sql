create table if not exists public.review_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('google')),
  channel text not null default 'google_business' check (channel in ('google_business')),
  provider_account_ref text,
  provider_location_ref text not null,
  place_id text,
  name text,
  address text,
  is_primary boolean not null default false,
  sync_status text not null default 'pending' check (
    sync_status in ('pending', 'syncing', 'ready', 'attention_required', 'failed')
  ),
  avg_rating_cached numeric(3, 2),
  review_count_cached integer not null default 0,
  last_synced_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_locations_workspace_provider_location_key unique (
    workspace_id,
    provider,
    provider_location_ref
  )
);

create index if not exists review_locations_workspace_provider_idx
  on public.review_locations (workspace_id, provider, created_at desc);

create index if not exists review_locations_workspace_primary_idx
  on public.review_locations (workspace_id, is_primary, created_at desc);

create table if not exists public.review_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  location_id uuid not null references public.review_locations(id) on delete cascade,
  provider text not null check (provider in ('google')),
  provider_review_id text not null,
  source_kind text not null default 'preview_seed' check (
    source_kind in ('preview_seed', 'google_sync')
  ),
  author_name text not null,
  rating integer not null check (rating between 1 and 5),
  body text not null,
  status text not null default 'new' check (
    status in ('new', 'unreplied', 'drafted', 'published', 'attention_required', 'archived')
  ),
  reply_status text not null default 'none' check (
    reply_status in ('none', 'drafted', 'approved', 'published', 'failed')
  ),
  created_at_provider timestamptz not null,
  owner_name text,
  draft_reply text,
  draft_updated_at timestamptz,
  published_reply text,
  published_reply_at timestamptz,
  published_by_name text,
  raw_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_items_workspace_provider_review_key unique (
    workspace_id,
    provider,
    provider_review_id
  )
);

create index if not exists review_items_workspace_provider_created_idx
  on public.review_items (workspace_id, provider, created_at_provider desc);

create index if not exists review_items_workspace_status_idx
  on public.review_items (workspace_id, status, created_at_provider desc);

create index if not exists review_items_location_idx
  on public.review_items (location_id, created_at_provider desc);

create table if not exists public.review_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('google')),
  location_id uuid references public.review_locations(id) on delete set null,
  sync_mode text not null default 'preview_seed' check (
    sync_mode in ('preview_seed', 'google_sync')
  ),
  status text not null default 'queued' check (
    status in ('queued', 'running', 'success', 'attention_required', 'failed')
  ),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  items_synced integer not null default 0,
  detail text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists review_sync_runs_workspace_provider_idx
  on public.review_sync_runs (workspace_id, provider, started_at desc);

alter table public.review_locations enable row level security;
alter table public.review_items enable row level security;
alter table public.review_sync_runs enable row level security;

drop policy if exists "Users can view review locations for workspace" on public.review_locations;
create policy "Users can view review locations for workspace"
  on public.review_locations
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));

drop policy if exists "Users can view review items for workspace" on public.review_items;
create policy "Users can view review items for workspace"
  on public.review_items
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));

drop policy if exists "Users can view review sync runs for workspace" on public.review_sync_runs;
create policy "Users can view review sync runs for workspace"
  on public.review_sync_runs
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));

comment on table public.review_locations is
  'Canonical review-source locations for BizzyBee review modules, starting with Google Reviews & Business Profile.';

comment on table public.review_items is
  'Workspace-scoped review objects used by the Reviews module inbox, ownership, draft, and reply flows.';

comment on table public.review_sync_runs is
  'Sync history for review imports and preview seeding so the Reviews module has a truthful run log.';
