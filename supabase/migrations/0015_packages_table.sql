-- 0015_packages_table.sql
-- Move hardcoded PACKAGES array into Supabase so superadmin can Add/Edit/Delete.

create table if not exists packages (
  id         uuid    primary key default gen_random_uuid(),
  name       text    not null,
  type       text    not null check (type in ('subscription', 'addon')),
  months     int     not null default 0,
  price      numeric not null default 0,
  sort_order int     not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz default now()
);

alter table packages enable row level security;

-- superadmin can do full CRUD
create policy "packages_superadmin" on packages
  for all
  using  ((select role from profiles where id = auth.uid()) = 'superadmin')
  with check ((select role from profiles where id = auth.uid()) = 'superadmin');

-- all authenticated users can read (to populate invoice form dropdowns)
create policy "packages_authenticated_read" on packages
  for select
  using (auth.uid() is not null);

-- Seed from the hardcoded list
insert into packages (name, type, months, price, sort_order) values
  ('Paket New Store',        'subscription', 3, 3500000,  1),
  ('Paket Lapak',            'subscription', 3, 5000000,  2),
  ('Paket Juragan',          'subscription', 3, 8000000,  3),
  ('Paket Sultan',           'subscription', 3, 10000000, 4),
  ('Big Company',            'subscription', 3, 15000000, 5),
  ('Trial Optimise 1 mo',    'subscription', 1, 2000000,  6),
  ('Add on Upload Etalase',  'addon',        0, 300000,   7),
  ('Friends Order',          'addon',        0, 350000,   8),
  ('Tiktok Affilitor Hunt',  'addon',        0, 1000000,  9),
  ('Foto + E-commerce Edit', 'addon',        0, 1500000,  10),
  ('Video generate AI',      'addon',        0, 500000,   11),
  ('Live + Pre-Content',     'addon',        0, 3000000,  12),
  ('Tiktok Short Konten',    'addon',        0, 2000000,  13)
on conflict do nothing;
