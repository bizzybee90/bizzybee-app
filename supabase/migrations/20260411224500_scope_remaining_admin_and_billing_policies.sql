do $$
begin
  if to_regprocedure('public.bb_user_in_workspace(uuid)') is null then
    raise exception 'Required helper missing: public.bb_user_in_workspace(uuid)';
  end if;
end
$$;

drop policy if exists "Admins can view workspace security incidents" on public.security_incidents;
create policy "Admins can view workspace security incidents"
  on public.security_incidents
  for select
  to authenticated
  using (
    auth.uid() is not null
    and public.has_role(auth.uid(), 'admin'::public.app_role)
    and workspace_id is not null
    and public.bb_user_in_workspace(workspace_id)
  );

drop policy if exists "Admins can manage security incidents" on public.security_incidents;
create policy "Admins can manage security incidents"
  on public.security_incidents
  for all
  to authenticated
  using (
    auth.uid() is not null
    and public.has_role(auth.uid(), 'admin'::public.app_role)
    and workspace_id is not null
    and public.bb_user_in_workspace(workspace_id)
  )
  with check (
    auth.uid() is not null
    and public.has_role(auth.uid(), 'admin'::public.app_role)
    and workspace_id is not null
    and public.bb_user_in_workspace(workspace_id)
  );

drop policy if exists "Admins can update deletion requests" on public.data_deletion_requests;
create policy "Admins can update deletion requests"
  on public.data_deletion_requests
  for update
  to authenticated
  using (
    auth.uid() is not null
    and public.has_role(auth.uid(), 'admin'::public.app_role)
    and exists (
      select 1
      from public.customers
      where customers.id = data_deletion_requests.customer_id
        and customers.workspace_id is not null
        and public.bb_user_in_workspace(customers.workspace_id)
    )
  )
  with check (
    auth.uid() is not null
    and public.has_role(auth.uid(), 'admin'::public.app_role)
    and exists (
      select 1
      from public.customers
      where customers.id = data_deletion_requests.customer_id
        and customers.workspace_id is not null
        and public.bb_user_in_workspace(customers.workspace_id)
    )
  );

drop policy if exists "Admins can manage retention policies" on public.data_retention_policies;
create policy "Admins can manage retention policies"
  on public.data_retention_policies
  for all
  to authenticated
  using (
    auth.uid() is not null
    and public.has_role(auth.uid(), 'admin'::public.app_role)
    and workspace_id is not null
    and public.bb_user_in_workspace(workspace_id)
  )
  with check (
    auth.uid() is not null
    and public.has_role(auth.uid(), 'admin'::public.app_role)
    and workspace_id is not null
    and public.bb_user_in_workspace(workspace_id)
  );

drop policy if exists "Admins can manage allowed IPs" on public.allowed_webhook_ips;
create policy "Admins can manage allowed IPs"
  on public.allowed_webhook_ips
  for all
  to authenticated
  using (
    auth.uid() is not null
    and public.has_role(auth.uid(), 'admin'::public.app_role)
    and workspace_id is not null
    and public.bb_user_in_workspace(workspace_id)
  )
  with check (
    auth.uid() is not null
    and public.has_role(auth.uid(), 'admin'::public.app_role)
    and workspace_id is not null
    and public.bb_user_in_workspace(workspace_id)
  );

drop policy if exists "Users can view workspace subscriptions" on public.workspace_subscriptions;
create policy "Users can view workspace subscriptions"
  on public.workspace_subscriptions
  for select
  to authenticated
  using (
    auth.uid() is not null
    and public.bb_user_in_workspace(workspace_id)
  );

drop policy if exists "Users can view workspace addons" on public.workspace_addons;
create policy "Users can view workspace addons"
  on public.workspace_addons
  for select
  to authenticated
  using (
    auth.uid() is not null
    and public.bb_user_in_workspace(workspace_id)
  );
