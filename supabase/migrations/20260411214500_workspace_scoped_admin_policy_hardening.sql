-- Hardening wave: scope legacy global admin/manager policy predicates
-- to workspace membership on workspace-owned tables.
--
-- This migration is additive and intentionally avoids rewriting history.
-- It only targets clearly unsafe legacy FOR ALL policies from the blocker audit.

do $$
begin
  if to_regprocedure('public.bb_user_in_workspace(uuid)') is null then
    raise exception 'Required helper missing: public.bb_user_in_workspace(uuid)';
  end if;
end
$$;

do $$
begin
  if to_regclass('public.workspace_channels') is null then
    return;
  end if;

  execute 'drop policy if exists "Admins can manage channels" on public.workspace_channels';
  execute 'drop policy if exists "bb_workspace_scoped_admin_manage_workspace_channels" on public.workspace_channels';

  execute $sql$
    create policy "bb_workspace_scoped_admin_manage_workspace_channels"
    on public.workspace_channels
    for all
    to authenticated
    using (
      auth.uid() is not null
      and public.bb_user_in_workspace(workspace_id)
      and public.has_role(auth.uid(), 'admin'::public.app_role)
    )
    with check (
      auth.uid() is not null
      and public.bb_user_in_workspace(workspace_id)
      and public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  $sql$;
end
$$;

do $$
begin
  if to_regclass('public.sla_configs') is null then
    return;
  end if;

  execute 'drop policy if exists "Managers can manage SLA configs" on public.sla_configs';
  execute 'drop policy if exists "bb_workspace_scoped_manager_admin_manage_sla_configs" on public.sla_configs';

  execute $sql$
    create policy "bb_workspace_scoped_manager_admin_manage_sla_configs"
    on public.sla_configs
    for all
    to authenticated
    using (
      auth.uid() is not null
      and public.bb_user_in_workspace(workspace_id)
      and (
        public.has_role(auth.uid(), 'manager'::public.app_role)
        or public.has_role(auth.uid(), 'admin'::public.app_role)
      )
    )
    with check (
      auth.uid() is not null
      and public.bb_user_in_workspace(workspace_id)
      and (
        public.has_role(auth.uid(), 'manager'::public.app_role)
        or public.has_role(auth.uid(), 'admin'::public.app_role)
      )
    )
  $sql$;
end
$$;

do $$
begin
  if to_regclass('public.business_facts') is null then
    return;
  end if;

  execute 'drop policy if exists "Admins can manage business facts" on public.business_facts';
  execute 'drop policy if exists "bb_workspace_scoped_admin_manage_business_facts" on public.business_facts';

  execute $sql$
    create policy "bb_workspace_scoped_admin_manage_business_facts"
    on public.business_facts
    for all
    to authenticated
    using (
      auth.uid() is not null
      and public.bb_user_in_workspace(workspace_id)
      and public.has_role(auth.uid(), 'admin'::public.app_role)
    )
    with check (
      auth.uid() is not null
      and public.bb_user_in_workspace(workspace_id)
      and public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  $sql$;
end
$$;

do $$
begin
  if to_regclass('public.price_list') is null then
    return;
  end if;

  execute 'drop policy if exists "Admins can manage pricing" on public.price_list';
  execute 'drop policy if exists "bb_workspace_scoped_admin_manage_price_list" on public.price_list';

  execute $sql$
    create policy "bb_workspace_scoped_admin_manage_price_list"
    on public.price_list
    for all
    to authenticated
    using (
      auth.uid() is not null
      and public.bb_user_in_workspace(workspace_id)
      and public.has_role(auth.uid(), 'admin'::public.app_role)
    )
    with check (
      auth.uid() is not null
      and public.bb_user_in_workspace(workspace_id)
      and public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  $sql$;
end
$$;

do $$
declare
  target_table text;
begin
  if to_regclass('public.faq_database') is not null then
    target_table := 'public.faq_database';
  elsif to_regclass('public.faqs') is not null then
    target_table := 'public.faqs';
  end if;

  if target_table is null then
    return;
  end if;

  execute format('drop policy if exists %I on %s', 'Admins can manage FAQs', target_table);
  execute format(
    'drop policy if exists %I on %s',
    'bb_workspace_scoped_admin_manage_faqs',
    target_table
  );

  execute format(
    $sql$
      create policy %I
      on %s
      for all
      to authenticated
      using (
        auth.uid() is not null
        and public.bb_user_in_workspace(workspace_id)
        and public.has_role(auth.uid(), 'admin'::public.app_role)
      )
      with check (
        auth.uid() is not null
        and public.bb_user_in_workspace(workspace_id)
        and public.has_role(auth.uid(), 'admin'::public.app_role)
      )
    $sql$,
    'bb_workspace_scoped_admin_manage_faqs',
    target_table
  );
end
$$;
