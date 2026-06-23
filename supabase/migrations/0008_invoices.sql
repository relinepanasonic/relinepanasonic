-- 0008_invoices.sql
-- Service package invoices per store. Only superadmin can access.

create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  owner        text,
  brand        text,
  store_name   text,
  package_name text not null,
  package_type text not null check (package_type in ('subscription', 'addon')),
  price_idr    bigint not null default 0,
  start_date   date not null,
  end_date     date,          -- null for add-ons (one-time); 3 months after start for subs
  notes        text,
  created_by   uuid references profiles(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table invoices enable row level security;

-- Only superadmin can read/write invoices
drop policy if exists "invoices_superadmin" on invoices;
create policy "invoices_superadmin" on invoices
  for all
  using  ((select role from profiles where id = auth.uid()) = 'superadmin')
  with check ((select role from profiles where id = auth.uid()) = 'superadmin');

-- Index for fast lookups by client
create index if not exists invoices_client_idx on invoices(client_id);
create index if not exists invoices_end_date_idx on invoices(end_date) where end_date is not null;
