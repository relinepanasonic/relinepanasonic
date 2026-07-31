import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import {
  BodReportDocument, prevMonth, lastN,
  type Summary, type BaselineVsActive, type Scope,
} from "@/lib/bodReportPdf";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/reports/bod — the Panasonic BOD deck, rendered from exactly the
// filter selection the caller has on screen.
//
// No extra role gate beyond "signed in": every figure comes from
// dashboard_summary / dashboard_baseline_vs_active, which are SECURITY
// DEFINER RPCs that already scope their result to the caller's role
// (pic_panasonic -> their city, sales -> their dealers, and so on). The
// PDF therefore contains exactly what that user can already see on the
// dashboard — it adds no new data exposure.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const f = (await req.json()) as Partial<Scope>;
  const year = f.year ? Number(f.year) : null;
  const quarter = f.quarter || null;
  const month = f.month || null;
  const week = f.week || null;
  const city = f.city || null;
  const dealer = f.dealer || null;

  const args = (y: number | null, q: string | null, m: string | null, w: string | null) => ({
    p_year: y, p_quarter: q, p_month: m, p_week: w, p_city: city, p_store: dealer,
  });

  // Comparison period for the MoM deltas: the previous month when a month
  // is picked, else the previous year when only a year is picked. With no
  // period filter at all there is nothing meaningful to compare against,
  // so deltas render as "—" rather than inventing a baseline.
  let prevArgs: ReturnType<typeof args> | null = null;
  if (year && month) {
    const p = prevMonth(year, month);
    prevArgs = args(p.year, null, p.month, week);
  } else if (year) {
    prevArgs = args(year - 1, quarter, null, week);
  }

  const [curRes, prevRes, trendRes, bvaRes] = await Promise.all([
    supabase.rpc("dashboard_summary", args(year, quarter, month, week)),
    prevArgs ? supabase.rpc("dashboard_summary", prevArgs) : Promise.resolve({ data: null, error: null }),
    // Trend charts need history: a month-filtered summary only ever holds
    // that one month's bucket, so this one drops month/week/quarter.
    supabase.rpc("dashboard_summary", args(year, null, null, null)),
    supabase.rpc("dashboard_baseline_vs_active", { p_city: city, p_store: dealer }),
  ]);

  if (curRes.error || !curRes.data) {
    return NextResponse.json({ error: curRes.error?.message || "Tidak ada data untuk filter ini" }, { status: 400 });
  }

  const current = curRes.data as Summary;
  const trendSummary = (trendRes.data as Summary) || null;
  const upTo = year && month ? { year, month } : undefined;
  const trend = lastN(trendSummary?.monthly_sales || [], 6, upTo);
  const costRoasTrend = lastN(trendSummary?.cost_roas || [], 6, upTo);

  const scopeLabel = dealer || city || "Seluruh Dealer Panasonic";
  const periodLabel = [
    month ? `${month} ${year ?? ""}`.trim()
      : quarter ? `${quarter} ${year ?? ""}`.trim()
      : year ? String(year)
      : "Seluruh Periode",
    week || null,
  ].filter(Boolean).join(" · ");

  const buffer = await renderToBuffer(
    BodReportDocument({
      scopeLabel,
      periodLabel,
      generatedAt: new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }),
      scope: { year: f.year || "", quarter: quarter || "", month: month || "", week: week || "", city: city || "", dealer: dealer || "" },
      current,
      previous: (prevRes.data as Summary) || null,
      trend,
      costRoasTrend,
      bva: (bvaRes.data as BaselineVsActive) || null,
    })
  );

  const safe = (v: string) => v.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const filename = `Laporan-BOD-Panasonic_${safe(scopeLabel)}_${safe(periodLabel) || "semua"}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
