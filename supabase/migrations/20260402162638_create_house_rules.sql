
create table house_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  rule_text text not null,
  category text not null default 'general',
  active boolean not null default true,
  source text not null default 'manual',
  source_context text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on house_rules (workspace_id, active);

alter table house_rules enable row level security;

create policy "Users can read own workspace rules"
  on house_rules for select to authenticated
  using (workspace_id in (select workspace_id from users where id = auth.uid()));

create policy "Users can manage own workspace rules"
  on house_rules for all to authenticated
  using (workspace_id in (select workspace_id from users where id = auth.uid()))
  with check (workspace_id in (select workspace_id from users where id = auth.uid()));

create policy "Service role full access on house_rules"
  on house_rules for all to service_role
  using (true)
  with check (true);
;
