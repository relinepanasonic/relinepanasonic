# ProfTokoOnline Dashboard — Setup

## 1. Create the Supabase project
1. Go to https://supabase.com/dashboard → **New project**.
2. Name it (e.g. `proftokoonline`), pick a region close to you, set a DB password.
3. Wait ~2 min for it to provision.

## 2. Apply the schema
1. In the project: **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/migrations/0001_init.sql` and **Run**.
   (You should see "Success. No rows returned".)

## 3. Get your API keys
**Project Settings → API**, copy:
- Project URL
- `anon` `public` key
- `service_role` key (keep secret)

## 4. Configure env
```bash
cp .env.local.example .env.local
```
Fill in the three values.

## 5. Create the first client + superadmin
In **SQL Editor**, run (edit the email):
```sql
-- a) create a client
insert into clients (name, slug, pic_label, store_label)
values ('Panasonic', 'panasonic', 'PIC Panasonic', 'Dealer');
```
Then **Authentication → Users → Add user** (email + password, auto-confirm).
Copy that user's UID, then:
```sql
-- b) make them superadmin (client_id NULL = sees all clients)
insert into profiles (id, client_id, role, display_name)
values ('PASTE-USER-UID', NULL, 'superadmin', 'Super Admin');
```

## 6. Run it
```bash
npm run dev
```
Open http://localhost:3000 → redirected to /login → sign in.
