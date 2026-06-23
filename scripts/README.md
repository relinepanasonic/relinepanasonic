# BigQuery → Supabase migration

One-time, resumable copy of the old Reline dashboard data out of BigQuery
(`reline-dashboard.RelineDashboard.*`) into this app's `sales_rows` / `uploads`
tables. The old GAS + BigQuery stack is **read only** — it keeps running
untouched, so both apps run in parallel.

## Prerequisites

1. **Supabase**: `.env.local` must have `NEXT_PUBLIC_SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` (already set for the deployed app).
2. **BigQuery auth** — pick one:
   - `gcloud auth application-default login` (easiest), **or**
   - `set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json`
     (the service account needs *BigQuery Data Viewer* + *Job User* on
     project `reline-dashboard`).
3. Schema migrations `0001`–`0005` already applied to the Supabase project.

## Run

```bash
npm run migrate:bq -- --dry-run        # inspect counts, write NOTHING
npm run migrate:bq                      # migrate everything
npm run migrate:bq -- --limit 3         # only the first 3 tables (smoke test)
npm run migrate:bq -- --seed-master     # also seed Core List (cities/dealers)
```

Re-running is safe: every `uploads.meta.bq_table` records its source table, so
already-migrated tables are skipped. A crash/timeout = just run it again.

## What it does

- Discovers BQ tables the same way the GAS app did (`^YYYYQn…`, must have a
  `Bulan` column; `_src` external pointers are ignored).
- For each table: one `uploads` row (audit/provenance in `meta`) + N
  `sales_rows`, mapped with the app's own `src/lib/parse.ts → mapRow()`, so
  migrated rows are identical to anything later uploaded through the UI.
- Applies the dealer-name typo fix (`Sumber Multi - CInere → Cinere`) and the
  SPOS parent-row flag (`is_parent`) on the way in.

## ⚠️ Verify before trusting parallel-run totals

`mapRow()` maps SPOS `sales_idr` from **"Total Penjualan (Pesanan Dibuat)"**
(orders *created*). The OLD GAS dashboard summed **"Pesanan Siap Dikirim"**
(ready-to-ship). The two apps will therefore show **different sales totals**.
If you want them to match, change the SPOS mapping in `src/lib/parse.ts` and
re-run this migration. (Separately: the `dashboard_summary` RPC groups monthly
sales by month name only, so 2025-Sep and 2026-Sep merge — unlike the old
"All Years" chart. Fix in `0005_dashboard_full.sql` if needed.)
