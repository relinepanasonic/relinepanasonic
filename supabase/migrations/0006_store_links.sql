-- =====================================================================
-- Stage 9c: split Core List into
--   - standalone lists: City, Platform        (master_data)
--   - combined triples : Owner · Store · Brand (store_links)
-- because Owner/Store/Brand are many-to-many (1 owner -> many stores
-- & brands; 1 brand -> many stores). Safe to re-run.
-- =====================================================================

create table if not exists store_links (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  owner      text,
  store_name text,
  brand      text,
  created_at timestamptz not null default now()
);
create index if not exists store_links_client_idx on store_links (client_id);

alter table store_links enable row level security;

drop policy if exists links_super_all   on store_links;
drop policy if exists links_client_read on store_links;
drop policy if exists links_admin_write on store_links;

create policy links_super_all on store_links
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');
create policy links_client_read on store_links
  for select using (client_id = my_client_id());
create policy links_admin_write on store_links
  for all
  using (client_id = my_client_id() and my_role() = 'client_admin')
  with check (client_id = my_client_id() and my_role() = 'client_admin');
