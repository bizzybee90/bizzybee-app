-- End-of-day structural/data repairs for ship-critical learning and inbox flows.

create or replace function public.bb_user_in_workspace(p_workspace_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_has_access boolean := false;
begin
  if auth.role() = 'service_role' then
    return true;
  end if;

  if v_uid is null or p_workspace_id is null then
    return false;
  end if;

  if to_regclass('public.workspace_members') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspace_members'
        and column_name = 'user_id'
    ) then
      execute
        'select exists (
           select 1
           from public.workspace_members
           where workspace_id = $1 and user_id = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspace_members'
        and column_name = 'member_id'
    ) then
      execute
        'select exists (
           select 1
           from public.workspace_members
           where workspace_id = $1 and member_id = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;
  end if;

  if to_regclass('public.users') is not null then
    execute
      'select exists (
         select 1
         from public.users
         where id = $2 and workspace_id = $1
       )'
    into v_has_access
    using p_workspace_id, v_uid;

    if v_has_access then
      return true;
    end if;
  end if;

  if to_regclass('public.workspaces') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspaces'
        and column_name = 'owner_id'
    ) then
      execute
        'select exists (
           select 1
           from public.workspaces
           where id = $1 and owner_id = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspaces'
        and column_name = 'created_by'
    ) then
      execute
        'select exists (
           select 1
           from public.workspaces
           where id = $1 and created_by = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;
  end if;

  return false;
end;
$$;
grant execute on function public.bb_user_in_workspace(uuid) to authenticated, service_role;
create or replace function public.user_has_workspace_access(check_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.bb_user_in_workspace(check_workspace_id)
$$;
grant execute on function public.user_has_workspace_access(uuid) to authenticated, service_role;
alter table public.email_import_progress
  add column if not exists completed_at timestamptz;
update public.email_import_progress
set completed_at = coalesce(
  completed_at,
  phase3_completed_at,
  phase2_completed_at,
  phase1_completed_at,
  updated_at,
  started_at,
  now()
)
where coalesce(current_phase, '') in ('complete', 'completed', 'done')
  and completed_at is null;
create or replace function public.bb_sync_email_import_progress_completed_at()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.current_phase, '') in ('complete', 'completed', 'done')
     and new.completed_at is null then
    new.completed_at := coalesce(
      new.phase3_completed_at,
      new.phase2_completed_at,
      new.phase1_completed_at,
      new.updated_at,
      now()
    );
  end if;

  return new;
end;
$$;
drop trigger if exists bb_set_email_import_progress_completed_at on public.email_import_progress;
create trigger bb_set_email_import_progress_completed_at
before insert or update on public.email_import_progress
for each row
execute function public.bb_sync_email_import_progress_completed_at();
alter table public.inbox_insights
  add column if not exists insight_type text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists severity text default 'info',
  add column if not exists metrics jsonb default '{}'::jsonb,
  add column if not exists period_start timestamptz,
  add column if not exists period_end timestamptz,
  add column if not exists is_read boolean default false,
  add column if not exists is_actionable boolean default false,
  add column if not exists action_taken boolean default false;
update public.inbox_insights
set insight_type = coalesce(insight_type, 'summary'),
    title = coalesce(title, 'Inbox learning insight'),
    description = coalesce(description, 'Generated from your workspace inbox activity.'),
    severity = coalesce(severity, 'info'),
    metrics = coalesce(metrics, '{}'::jsonb),
    is_read = coalesce(is_read, false),
    is_actionable = coalesce(is_actionable, false),
    action_taken = coalesce(action_taken, false)
where insight_type is null
   or title is null
   or description is null
   or severity is null
   or metrics is null
   or is_read is null
   or is_actionable is null
   or action_taken is null;
drop policy if exists "Users can view their workspace email import progress" on public.email_import_progress;
drop policy if exists "Users can update their workspace email import progress" on public.email_import_progress;
drop policy if exists "Users can insert their workspace email import progress" on public.email_import_progress;
drop policy if exists "Users can view workspace import progress" on public.email_import_progress;
drop policy if exists "Users can update workspace import progress" on public.email_import_progress;
drop policy if exists "Users can insert workspace import progress" on public.email_import_progress;
drop policy if exists "Users can view import progress" on public.email_import_progress;
drop policy if exists "Users can update import progress" on public.email_import_progress;
drop policy if exists "Users can insert import progress" on public.email_import_progress;
drop policy if exists "Service role can manage import progress" on public.email_import_progress;
drop policy if exists "Service role full access to import progress" on public.email_import_progress;
drop policy if exists "Service role has full access to email_import_progress" on public.email_import_progress;
drop policy if exists bb_email_import_progress_select on public.email_import_progress;
drop policy if exists bb_email_import_progress_insert on public.email_import_progress;
drop policy if exists bb_email_import_progress_update on public.email_import_progress;
drop policy if exists bb_email_import_progress_delete on public.email_import_progress;
drop policy if exists bb_email_import_progress_service on public.email_import_progress;
create policy bb_email_import_progress_select
  on public.email_import_progress
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_email_import_progress_insert
  on public.email_import_progress
  for insert
  to authenticated
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_email_import_progress_update
  on public.email_import_progress
  for update
  to authenticated
  using (public.bb_user_in_workspace(workspace_id))
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_email_import_progress_delete
  on public.email_import_progress
  for delete
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_email_import_progress_service
  on public.email_import_progress
  for all
  to service_role
  using (true)
  with check (true);
drop policy if exists "Users can view their workspace inbox insights" on public.inbox_insights;
drop policy if exists "Users can insert their workspace inbox insights" on public.inbox_insights;
drop policy if exists "Users can update their workspace inbox insights" on public.inbox_insights;
drop policy if exists "inbox_insights_workspace_access" on public.inbox_insights;
drop policy if exists "inbox_insights_service_role" on public.inbox_insights;
drop policy if exists bb_inbox_insights_select on public.inbox_insights;
drop policy if exists bb_inbox_insights_insert on public.inbox_insights;
drop policy if exists bb_inbox_insights_update on public.inbox_insights;
drop policy if exists bb_inbox_insights_delete on public.inbox_insights;
drop policy if exists bb_inbox_insights_service on public.inbox_insights;
create policy bb_inbox_insights_select
  on public.inbox_insights
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_inbox_insights_insert
  on public.inbox_insights
  for insert
  to authenticated
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_inbox_insights_update
  on public.inbox_insights
  for update
  to authenticated
  using (public.bb_user_in_workspace(workspace_id))
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_inbox_insights_delete
  on public.inbox_insights
  for delete
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_inbox_insights_service
  on public.inbox_insights
  for all
  to service_role
  using (true)
  with check (true);
drop policy if exists "Users can view their workspace learned responses" on public.learned_responses;
drop policy if exists "Users can insert their workspace learned responses" on public.learned_responses;
drop policy if exists "Users can update their workspace learned responses" on public.learned_responses;
drop policy if exists bb_learned_responses_select on public.learned_responses;
drop policy if exists bb_learned_responses_insert on public.learned_responses;
drop policy if exists bb_learned_responses_update on public.learned_responses;
drop policy if exists bb_learned_responses_delete on public.learned_responses;
drop policy if exists bb_learned_responses_service on public.learned_responses;
create policy bb_learned_responses_select
  on public.learned_responses
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_learned_responses_insert
  on public.learned_responses
  for insert
  to authenticated
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_learned_responses_update
  on public.learned_responses
  for update
  to authenticated
  using (public.bb_user_in_workspace(workspace_id))
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_learned_responses_delete
  on public.learned_responses
  for delete
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_learned_responses_service
  on public.learned_responses
  for all
  to service_role
  using (true)
  with check (true);
drop policy if exists "Users can view workspace triage corrections" on public.triage_corrections;
drop policy if exists "Users can create triage corrections" on public.triage_corrections;
drop policy if exists bb_triage_corrections_select on public.triage_corrections;
drop policy if exists bb_triage_corrections_insert on public.triage_corrections;
drop policy if exists bb_triage_corrections_update on public.triage_corrections;
drop policy if exists bb_triage_corrections_delete on public.triage_corrections;
drop policy if exists bb_triage_corrections_service on public.triage_corrections;
create policy bb_triage_corrections_select
  on public.triage_corrections
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_triage_corrections_insert
  on public.triage_corrections
  for insert
  to authenticated
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_triage_corrections_update
  on public.triage_corrections
  for update
  to authenticated
  using (public.bb_user_in_workspace(workspace_id))
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_triage_corrections_delete
  on public.triage_corrections
  for delete
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_triage_corrections_service
  on public.triage_corrections
  for all
  to service_role
  using (true)
  with check (true);
drop policy if exists "Users can view workspace sender rules" on public.sender_rules;
drop policy if exists "Users can manage workspace sender rules" on public.sender_rules;
drop policy if exists bb_sender_rules_select on public.sender_rules;
drop policy if exists bb_sender_rules_insert on public.sender_rules;
drop policy if exists bb_sender_rules_update on public.sender_rules;
drop policy if exists bb_sender_rules_delete on public.sender_rules;
drop policy if exists bb_sender_rules_service on public.sender_rules;
create policy bb_sender_rules_select
  on public.sender_rules
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_sender_rules_insert
  on public.sender_rules
  for insert
  to authenticated
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_sender_rules_update
  on public.sender_rules
  for update
  to authenticated
  using (public.bb_user_in_workspace(workspace_id))
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_sender_rules_delete
  on public.sender_rules
  for delete
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_sender_rules_service
  on public.sender_rules
  for all
  to service_role
  using (true)
  with check (true);
drop policy if exists "Users can view workspace business context" on public.business_context;
drop policy if exists "Users can manage workspace business context" on public.business_context;
drop policy if exists "authenticated_workspace_select_business_context" on public.business_context;
drop policy if exists "authenticated_workspace_all_business_context" on public.business_context;
drop policy if exists "service_role_business_context" on public.business_context;
drop policy if exists bb_business_context_select on public.business_context;
drop policy if exists bb_business_context_insert on public.business_context;
drop policy if exists bb_business_context_update on public.business_context;
drop policy if exists bb_business_context_delete on public.business_context;
drop policy if exists bb_business_context_service on public.business_context;
create policy bb_business_context_select
  on public.business_context
  for select
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_business_context_insert
  on public.business_context
  for insert
  to authenticated
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_business_context_update
  on public.business_context
  for update
  to authenticated
  using (public.bb_user_in_workspace(workspace_id))
  with check (public.bb_user_in_workspace(workspace_id));
create policy bb_business_context_delete
  on public.business_context
  for delete
  to authenticated
  using (public.bb_user_in_workspace(workspace_id));
create policy bb_business_context_service
  on public.business_context
  for all
  to service_role
  using (true)
  with check (true);
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete
  on public.email_import_progress,
     public.inbox_insights,
     public.learned_responses,
     public.triage_corrections,
     public.sender_rules,
     public.business_context
  to authenticated;
grant all
  on public.email_import_progress,
     public.inbox_insights,
     public.learned_responses,
     public.triage_corrections,
     public.sender_rules,
     public.business_context
  to service_role;
