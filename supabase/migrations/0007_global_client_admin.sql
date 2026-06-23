-- =====================================================================
-- Make client_admin a GLOBAL admin (sees & edits all clients), like
-- superadmin for data. Only branch_manager (city) and store_user (store)
-- stay client-scoped. superadmin stays the only one who can manage
-- superadmins / the clients table.
--
-- After this, a client_admin's profile carries client_id = NULL.
-- Safe to re-run.
-- =====================================================================

-- ---------- sales_rows ----------
drop policy if exists sales_super_all              on sales_rows;
drop policy if exists sales_client_scoped_read     on sales_rows;
drop policy if exists sales_client_admin_write     on sales_rows;
drop policy if exists sales_admin_all              on sales_rows;
drop policy if exists sales_scoped_read            on sales_rows;

-- superadmin + client_admin: full global access
create policy sales_admin_all on sales_rows
  for all
  using (my_role() in ('superadmin','client_admin'))
  with check (my_role() in ('superadmin','client_admin'));

-- branch_manager / store_user: read only within their client + scope
create policy sales_scoped_read on sales_rows
  for select using (
    client_id = my_client_id()
    and (
      (my_role() = 'branch_manager' and city = my_scope_city())
      or (my_role() = 'store_user'     and store_name = my_scope_store())
    )
  );

-- ---------- uploads ----------
drop policy if exists uploads_super_all      on uploads;
drop policy if exists uploads_client_read    on uploads;
drop policy if exists uploads_client_write   on uploads;
drop policy if exists uploads_admin_all      on uploads;
drop policy if exists uploads_scoped_read    on uploads;

create policy uploads_admin_all on uploads
  for all
  using (my_role() in ('superadmin','client_admin'))
  with check (my_role() in ('superadmin','client_admin'));
create policy uploads_scoped_read on uploads
  for select using (client_id = my_client_id());

-- ---------- clients ----------
drop policy if exists clients_super_all   on clients;
drop policy if exists clients_read_own    on clients;
drop policy if exists clients_admin_read  on clients;

-- only superadmin manages the clients table
create policy clients_super_all on clients
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');
-- client_admin reads ALL clients; scoped roles read their own
create policy clients_admin_read on clients
  for select using (my_role() = 'client_admin' or id = my_client_id());

-- ---------- profiles ----------
drop policy if exists profiles_self_read     on profiles;
drop policy if exists profiles_super_all     on profiles;
drop policy if exists profiles_admin_client  on profiles;
drop policy if exists profiles_admin_all     on profiles;

create policy profiles_self_read on profiles
  for select using (id = auth.uid());
create policy profiles_super_all on profiles
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');
-- client_admin manages all profiles EXCEPT superadmins
create policy profiles_admin_all on profiles
  for all
  using (my_role() = 'client_admin' and role <> 'superadmin')
  with check (my_role() = 'client_admin' and role <> 'superadmin');

-- ---------- master_data (Core List) ----------
drop policy if exists master_super_all     on master_data;
drop policy if exists master_client_read   on master_data;
drop policy if exists master_admin_write   on master_data;
drop policy if exists master_admin_all     on master_data;

create policy master_admin_all on master_data
  for all
  using (my_role() in ('superadmin','client_admin'))
  with check (my_role() in ('superadmin','client_admin'));
create policy master_client_read on master_data
  for select using (client_id = my_client_id());

-- ---------- store_links (Core List) ----------
drop policy if exists links_super_all    on store_links;
drop policy if exists links_client_read  on store_links;
drop policy if exists links_admin_write  on store_links;
drop policy if exists links_admin_all    on store_links;

create policy links_admin_all on store_links
  for all
  using (my_role() in ('superadmin','client_admin'))
  with check (my_role() in ('superadmin','client_admin'));
create policy links_client_read on store_links
  for select using (client_id = my_client_id());
