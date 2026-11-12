import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WORKSPACES } from "@/lib/workspace";
import { ERP_NO_STORE, checkErpAuth } from "@/lib/erpAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/erp/top-products?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=10
//
// Read-only feed for the accounting ERP: the best-selling products of every store (dealer) per workspace in a date range, for page 2 of the
// ERP's weekly report. Supabase Migration/106 has the definitions.
//   - store / workspace are written exactly as /api/erp/performance writes them (store_name of sales_rows, the workspace name).
//   - "sales" = the dashboard's "10 Produk Terlaris": SPOS (Product Performa) parent rows, brand Panasonic, "Month Awal" left out; products with no sales are left out.
//   - A row belongs to the range when its week (the Monday of its period start, as in /api/erp/performance) is inside from..to. A Monday-to-Sunday
//     week asked as from=Monday, to=Sunday returns exactly that week. Any range up to 62 days works.
//   - Sorted by sales descending (equal sales: name A-Z); a store without product sales in the range is not listed.
//   - Names and numbers only: no emails, file contents or storage URLs.

const MAX_RANGE_DAYS = 62;
const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (error: string) => NextResponse.json({ error }, { status: 400, headers: ERP_NO_STORE });

type Block = { store: string; products: { name: string; sales: number }[] };

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };   // plain numbers, never negative

export async function GET(req: NextRequest) {
  if (!checkErpAuth(req)) return new NextResponse(null, { status: 401, headers: ERP_NO_STORE });

  const from = req.nextUrl.searchParams.get("from") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return bad("from and to are required, as YYYY-MM-DD");
  const f = Date.parse(from + "T00:00:00Z"), t = Date.parse(to + "T00:00:00Z");
  if (Number.isNaN(f) || Number.isNaN(t) || new Date(f).toISOString().slice(0, 10) !== from || new Date(t).toISOString().slice(0, 10) !== to || t < f) return bad("invalid date range");
  if ((t - f) / 86_400_000 + 1 > MAX_RANGE_DAYS) return bad(`range too long, max ${MAX_RANGE_DAYS} days`);

  const rawLimit = req.nextUrl.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) return bad(`limit must be a whole number from 1 to ${MAX_LIMIT}`);
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_LIMIT) return bad(`limit must be a whole number from 1 to ${MAX_LIMIT}`);
  }

  const parts = await Promise.all(WORKSPACES.map(async (w) => {
    const db = createAdminClient(w.schema);
    const { data, error } = await db.rpc("erp_top_products", { p_from: from, p_to: to, p_limit: limit });
    return { w, error: !!error, blocks: ((data as Block[]) || []) };
  }));
  if (parts.some((p) => p.error)) return NextResponse.json({ error: "query failed" }, { status: 500, headers: ERP_NO_STORE });

  const stores = parts.flatMap(({ w, blocks }) => blocks.map((b) => ({
    store: b.store, workspace: w.name,
    products: (b.products || [])
      .map((p) => ({ name: String(p.name ?? "").trim(), sales: num(p.sales) }))
      .filter((p) => p.name && p.sales > 0)
      .sort((a, b2) => b2.sales - a.sales || a.name.localeCompare(b2.name))
      .slice(0, limit),
  }))).filter((s) => s.products.length > 0);
  stores.sort((a, b) => a.workspace.localeCompare(b.workspace) || a.store.localeCompare(b.store));

  return NextResponse.json({ generatedAt: new Date().toISOString(), timezone: "Asia/Jakarta", from, to, stores }, { status: 200, headers: ERP_NO_STORE });
}
