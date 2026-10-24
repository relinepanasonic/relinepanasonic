import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WORKSPACES } from "@/lib/workspace";
import { ERP_NO_STORE, checkErpAuth } from "@/lib/erpAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/erp/performance?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Read-only feed for the accounting ERP: the store performance of ALL workspaces, one row per store per WEEK, with the numbers of this
// app's own dashboard (Panasonic sales, GMV, traffic, in-cart, ads by type, baseline vs active ...). Supabase Migration/82 has the definitions.
//   - A week belongs to the month of its Monday and is never split: periodStart is that Monday, periodEnd is +6 days.
//   - from / to are inclusive calendar days; rows whose periodStart is inside the range are returned. At most 370 days.
//   - The numbers are read from a weekly cache that is rebuilt (once, ~30 s) when an upload or delete changed the data since the last call.
//   - `workspace` is added to every row, because the same store name may exist in several workspaces.
//   - Names and numbers only: no emails, file contents or storage URLs.

const MAX_RANGE_DAYS = 370;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (error: string) => NextResponse.json({ error }, { status: 400, headers: ERP_NO_STORE });

type Ads = { cost: number; sales: number; views: number; clicks: number; addToCart: number; orders: number; itemsSold: number };
type Row = {
  store: string; periodStart: string; periodEnd: string; granularity: "week";
  sales: number; gmv: number; traffic: number; addToCart: number; orders: number; itemsSold: number; productViews: number; productClicks: number;
  baselineSales: number; activeSales: number; ads: { gmvMax: Ads; group: Ads; independent: Ads };
};

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };   // plain numbers, never negative
const ads = (a: Partial<Record<keyof Ads, unknown>> | undefined): Ads => ({
  cost: num(a?.cost), sales: num(a?.sales), views: num(a?.views), clicks: num(a?.clicks), addToCart: num(a?.addToCart), orders: num(a?.orders), itemsSold: num(a?.itemsSold),
});

export async function GET(req: NextRequest) {
  if (!checkErpAuth(req)) return new NextResponse(null, { status: 401, headers: ERP_NO_STORE });

  const from = req.nextUrl.searchParams.get("from") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return bad("from and to are required, as YYYY-MM-DD");
  const f = Date.parse(from + "T00:00:00Z"), t = Date.parse(to + "T00:00:00Z");
  if (Number.isNaN(f) || Number.isNaN(t) || new Date(f).toISOString().slice(0, 10) !== from || new Date(t).toISOString().slice(0, 10) !== to || t < f) return bad("invalid date range");
  if ((t - f) / 86_400_000 + 1 > MAX_RANGE_DAYS) return bad(`range too long, max ${MAX_RANGE_DAYS} days`);

  const parts = await Promise.all(WORKSPACES.map(async (w) => {
    const db = createAdminClient(w.schema);
    const fresh = await db.rpc("erp_perf_refresh_if_stale");        // rebuilds the weekly cache only if the data changed
    if (fresh.error) return { w, error: true, rows: [] as Row[] };
    const { data, error } = await db.rpc("erp_performance", { p_from: from, p_to: to });
    return { w, error: !!error, rows: ((data as Row[]) || []) };
  }));
  if (parts.some((p) => p.error)) return NextResponse.json({ error: "query failed" }, { status: 500, headers: ERP_NO_STORE });

  const rows = parts.flatMap(({ w, rows }) => rows.map((r) => ({
    store: r.store, workspace: w.name, periodStart: r.periodStart, periodEnd: r.periodEnd, granularity: "week" as const,
    sales: num(r.sales), gmv: num(r.gmv), traffic: num(r.traffic), addToCart: num(r.addToCart), orders: num(r.orders), itemsSold: num(r.itemsSold),
    productViews: num(r.productViews), productClicks: num(r.productClicks), baselineSales: num(r.baselineSales), activeSales: num(r.activeSales),
    ads: { gmvMax: ads(r.ads?.gmvMax), group: ads(r.ads?.group), independent: ads(r.ads?.independent) },
  })));
  rows.sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.store.localeCompare(b.store) || a.workspace.localeCompare(b.workspace));

  return NextResponse.json({ generatedAt: new Date().toISOString(), timezone: "Asia/Jakarta", rows }, { status: 200, headers: ERP_NO_STORE });
}
