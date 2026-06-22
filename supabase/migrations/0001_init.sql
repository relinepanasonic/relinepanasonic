-- =====================================================================
-- ProfTokoOnline multi-client dashboard — initial schema
-- Replaces the GAS BQ table-naming scheme with plain columns + RLS.
-- Safe to re-run: the teardown below clears any partial previous run.
-- =====================================================================

-- ---------- teardown (idempotent) ----------
drop table if exists sales_rows cascade;
drop table if exists uploads    cascade;
drop table if exists profiles   cascade;
drop table if exists clients    cascade;
drop function if exists my_role()        cascade;
drop function if exists my_client_id()   cascade;
drop function if exists my_scope_city()  cascade;
drop function if exists my_scope_store() cascade;
drop type if exists data_source cascade;
drop type if exists user_role   cascade;

-- ---------- enums ----------
create type user_role as enum ('superadmin', 'client_admin', 'branch_manager', 'store_user');
create type data_source as enum ('spos', 'ads', 'perf');

-- ---------- clients ----------
-- One row per client (Panasonic, and your other non-Panasonic clients).
-- label fields drive the UI text so "PIC Panasonic" -> "PIC Client",
-- "Dealer" -> "Store Name" with zero code changes.
create table clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  pic_label   text not null default 'PIC',         -- e.g. 'PIC Panasonic' / 'PIC Client'
  store_label text not null default 'Store Name',   -- e.g. 'Dealer' / 'Store Name'
  logo_url    text,
  brand_color text default '#2563eb',
  created_at  timestamptz not null default now()
);

-- ---------- profiles ----------
-- 1:1 with Supabase auth.users. superadmin has client_id = NULL (sees all).
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  client_id    uuid references clients(id) on delete cascade,
  role         user_role not null default 'store_user',
  display_name text,
  scope_city   text,   -- branch_manager: locked to this city
  scope_store  text,   -- store_user: locked to this store_name
  created_at   timestamptz not null default now()
);

-- ---------- uploads ----------
-- One row per uploaded file (audit + delete-by-upload, like UploadLog tab).
create table uploads (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  source      data_source not null,
  filename    text,
  uploaded_by uuid references auth.users(id),
  row_count   int not null default 0,
  -- snapshot of the shared manual fields entered in the upload form
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- sales_rows ----------
-- Typed dimensions + key metrics for fast aggregation; full original row in raw.
create table sales_rows (
  id           bigint generated always as identity primary key,
  client_id    uuid not null references clients(id) on delete cascade,
  upload_id    uuid references uploads(id) on delete cascade,
  source       data_source not null,

  -- dimensions (the GROUP BY axes)
  year         int,
  month        text,          -- "Bulan" (Indonesian month name kept as-is)
  week         text,          -- "Week"
  city         text,
  store_name   text,          -- was "Dealer"
  pic_client   text,          -- was "PIC Panasonic"
  brand        text,
  product_type text,          -- "Tipe Produk"
  item_name    text,          -- Produk (SPOS) / Nama Iklan (Ads)
  tanggal      date,

  -- key metrics (numeric, extracted for aggregation; NULL when N/A for source)
  sales_idr    numeric,       -- Total Penjualan / Omzet
  orders       numeric,       -- Total Pembeli / Pesanan
  units        numeric,       -- Produk Terjual / Dipesan
  visitors     numeric,       -- Pengunjung / Kunjungan
  ad_cost      numeric,       -- Biaya (ads only)

  -- SPOS parent-row flag: true when traffic present (avoids double-counting variants)
  is_parent    boolean not null default true,

  raw          jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------- indexes ----------
create index sales_rows_client_dims_idx
  on sales_rows (client_id, year, month, city, store_name, source);
create index sales_rows_brand_idx on sales_rows (client_id, brand);
create index sales_rows_upload_idx on sales_rows (upload_id);
create index profiles_client_idx on profiles (client_id);

-- =====================================================================
-- RLS
-- Helper functions are SECURITY DEFINER to read the caller's profile
-- without triggering recursive RLS on the profiles table.
-- =====================================================================
create or replace function my_role() returns user_role
  language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function my_client_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select client_id from profiles where id = auth.uid()
$$;

create or replace function my_scope_city() returns text
  language sql stable security definer set search_path = public as $$
  select scope_city from profiles where id = auth.uid()
$$;

create or replace function my_scope_store() returns text
  language sql stable security definer set search_path = public as $$
  select scope_store from profiles where id = auth.uid()
$$;

alter table clients     enable row level security;
alter table profiles    enable row level security;
alter table uploads     enable row level security;
alter table sales_rows  enable row level security;

-- clients: superadmin manages all; everyone can read their own client.
create policy clients_super_all on clients
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');
create policy clients_read_own on clients
  for select using (id = my_client_id());

-- profiles: you can always read your own; superadmin reads/writes all;
-- client_admin manages profiles within their client.
create policy profiles_self_read on profiles
  for select using (id = auth.uid());
create policy profiles_super_all on profiles
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');
create policy profiles_admin_client on profiles
  for all
  using (my_role() = 'client_admin' and client_id = my_client_id())
  with check (my_role() = 'client_admin' and client_id = my_client_id());

-- uploads: superadmin all; otherwise within own client (admins write, others read).
create policy uploads_super_all on uploads
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');
create policy uploads_client_read on uploads
  for select using (client_id = my_client_id());
create policy uploads_client_write on uploads
  for all
  using (client_id = my_client_id() and my_role() in ('client_admin'))
  with check (client_id = my_client_id() and my_role() in ('client_admin'));

-- sales_rows: superadmin all. Within a client, scope by role:
--   client_admin  -> whole client
--   branch_manager-> only their city
--   store_user    -> only their store_name
create policy sales_super_all on sales_rows
  for all using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

create policy sales_client_scoped_read on sales_rows
  for select using (
    client_id = my_client_id()
    and (
      my_role() = 'client_admin'
      or (my_role() = 'branch_manager' and city = my_scope_city())
      or (my_role() = 'store_user'     and store_name = my_scope_store())
    )
  );

create policy sales_client_admin_write on sales_rows
  for all
  using (client_id = my_client_id() and my_role() = 'client_admin')
  with check (client_id = my_client_id() and my_role() = 'client_admin');
