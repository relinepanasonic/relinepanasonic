import {
  Document, Page, View, Text, StyleSheet, Svg, Rect, Line as SvgLine, Font,
} from "@react-pdf/renderer";
import { MONTH_LIST } from "@/lib/parse";

// ---------- shared types (subset of the dashboard's Summary RPC result) ----------
export type Kpis = { sales: number; gmv: number; traffic: number; in_cart: number; ad_cost: number; roas: number | null };
export type MonthPoint = { year: number | null; month: string; sales: number };
export type Dealer = {
  store_name: string; city: string; sales: number; traffic: number; in_cart: number;
  ad_cost: number; roas: number | null; trend: MonthPoint[];
};
export type Summary = {
  kpis: Kpis;
  monthly_sales: MonthPoint[];
  top_products: { name: string; sales: number }[];
  brand_share: { brand: string; sales: number }[];
  by_category: { category: string; sales: number }[];
  dealers: Dealer[];
};

export type ReportType = "ceo" | "brand_manager" | "dealer_owner";

// ---------- formatting helpers ----------
export const idr = (n: number | null | undefined) => {
  const v = n || 0, a = Math.abs(v);
  if (a >= 1e9) return "Rp " + (v / 1e9).toFixed(2) + "M";
  if (a >= 1e6) return "Rp " + (v / 1e6).toFixed(1) + "jt";
  if (a >= 1e3) return "Rp " + Math.round(v / 1e3) + "rb";
  return "Rp " + Math.round(v);
};
export const idrFull = (n: number | null | undefined) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
export const compact = (n: number | null | undefined) => {
  const v = n || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return String(Math.round(v));
};
export const roasFmt = (n: number | null | undefined) => (n ? n.toFixed(2) + "×" : "—");

export function prevMonth(year: number, month: string): { year: number; month: string } {
  const idx = MONTH_LIST.indexOf(month);
  if (idx < 0) return { year, month };
  if (idx === 0) return { year: year - 1, month: MONTH_LIST[11] };
  return { year, month: MONTH_LIST[idx - 1] };
}

function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
function deltaLabel(cur: number, prev: number | undefined | null): string {
  if (prev === undefined || prev === null) return "no prior data";
  const pct = pctDelta(cur, prev);
  if (pct === null) return cur > 0 ? "new this month" : "flat";
  if (Math.abs(pct) < 0.5) return "flat vs last month";
  // Plain ASCII +/- instead of unicode arrows — react-pdf's base Helvetica
  // font has no glyph for ▲/▼, which renders as tofu and corrupts the
  // spacing of the text that follows it.
  return `${pct > 0 ? "+" : "-"}${Math.abs(pct).toFixed(1)}% vs last month`;
}

function monthKey(year: number | null, month: string): number {
  const idx = MONTH_LIST.indexOf(month);
  return (year ?? 0) * 12 + (idx < 0 ? 0 : idx);
}

// Trend history isn't available from a month-filtered summary (that filter
// restricts every field, including monthly_sales, to just that one month) —
// callers must fetch an unfiltered-by-month summary for this.
export function lastNMonthsUpTo(points: MonthPoint[], year: number, month: string, n = 6): MonthPoint[] {
  const targetKey = monthKey(year, month);
  return [...points]
    .filter((p) => p.month && monthKey(p.year, p.month) <= targetKey)
    .sort((a, b) => monthKey(a.year, a.month) - monthKey(b.year, b.month))
    .slice(-n);
}

export function buildNarrative(cur: Kpis, prev: Kpis | null): string[] {
  const bullets: string[] = [];
  bullets.push(`Panasonic Sales: ${idr(cur.sales)} (${deltaLabel(cur.sales, prev?.sales)})`);
  bullets.push(`Total GMV: ${idr(cur.gmv)} (${deltaLabel(cur.gmv, prev?.gmv)})`);
  bullets.push(`Traffic: ${compact(cur.traffic)} visitors (${deltaLabel(cur.traffic, prev?.traffic)})`);
  bullets.push(`Ads Cost: ${idr(cur.ad_cost)} (${deltaLabel(cur.ad_cost, prev?.ad_cost)})`);
  bullets.push(`ROAS: ${roasFmt(cur.roas)} (${cur.roas != null && prev?.roas != null ? deltaLabel(cur.roas, prev.roas) : "no prior data"})`);
  return bullets;
}

// ---------- styles ----------
const NAVY = "#12213b";
const GOLD = "#b4881f";
const MUTED = "#6b7688";
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: "#1c2434", fontFamily: "Helvetica" },
  header: { marginBottom: 18, borderBottom: `2 solid ${GOLD}`, paddingBottom: 12 },
  title: { fontSize: 20, fontWeight: 700, color: NAVY },
  subtitle: { fontSize: 11, color: MUTED, marginTop: 4 },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 8 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard: { width: "31%", backgroundColor: "#f4f6fa", borderRadius: 6, padding: 10, marginBottom: 8 },
  kpiLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", fontWeight: 700 },
  kpiVal: { fontSize: 14, fontWeight: 700, color: NAVY, marginTop: 3 },
  kpiDelta: { fontSize: 8, color: MUTED, marginTop: 2 },
  bullet: { flexDirection: "row", marginBottom: 5 },
  bulletDot: { width: 10, color: GOLD, fontWeight: 700 },
  bulletText: { flex: 1 },
  table: { marginTop: 4 },
  tr: { flexDirection: "row", borderBottom: "1 solid #e2e6ee", paddingVertical: 5 },
  th: { flexDirection: "row", borderBottom: `1.5 solid ${NAVY}`, paddingVertical: 5 },
  thText: { fontSize: 8.5, fontWeight: 700, color: NAVY, textTransform: "uppercase" },
  tdText: { fontSize: 9 },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 8, color: MUTED, textAlign: "center", borderTop: "1 solid #e2e6ee", paddingTop: 8 },
});

// ---------- bar chart drawn with plain SVG rects (no headless browser needed) ----------
function BarChartSvg({ data, width = 500, height = 140, color = GOLD }: { data: { label: string; value: number }[]; width?: number; height?: number; color?: string }) {
  if (!data.length) return <Text style={{ fontSize: 9, color: MUTED }}>No data</Text>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const padL = 8, padR = 8, padTop = 16, padBottom = 22;
  const chartW = width - padL - padR, chartH = height - padTop - padBottom;
  const gap = 6;
  const barW = (chartW - gap * (data.length - 1)) / data.length;
  return (
    <Svg width={width} height={height}>
      <SvgLine x1={padL} y1={padTop + chartH} x2={width - padR} y2={padTop + chartH} stroke="#d7dce6" strokeWidth={1} />
      {data.map((d, i) => {
        const barH = Math.max((d.value / max) * chartH, 1);
        const x = padL + i * (barW + gap);
        const y = padTop + chartH - barH;
        return (
          <React_Fragment key={i}>
            <Rect x={x} y={y} width={barW} height={barH} fill={color} rx={2} />
            <Text x={x + barW / 2} y={padTop + chartH + 13} style={{ fontSize: 7, fill: MUTED, textAnchor: "middle" } as unknown as Record<string, unknown>}>
              {d.label}
            </Text>
          </React_Fragment>
        );
      })}
    </Svg>
  );
}
// react-pdf's <Text>/<Svg> children need a real fragment; alias to avoid an
// extra import line clash with React's own Fragment when JSX-transformed.
import { Fragment as React_Fragment } from "react";

function RankTable({ title, rows }: { title: string; rows: { name: string; sub: string; sales: number; roas: number | null }[] }) {
  if (!rows.length) return null;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{title}</Text>
      <View style={styles.th}>
        <Text style={[styles.thText, { flex: 2 }]}>Name</Text>
        <Text style={[styles.thText, { flex: 1.4 }]}>City</Text>
        <Text style={[styles.thText, { flex: 1, textAlign: "right" }]}>Sales</Text>
        <Text style={[styles.thText, { flex: 1, textAlign: "right" }]}>ROAS</Text>
      </View>
      {rows.map((r, i) => (
        <View style={styles.tr} key={i}>
          <Text style={[styles.tdText, { flex: 2 }]}>{r.name}</Text>
          <Text style={[styles.tdText, { flex: 1.4, color: MUTED }]}>{r.sub}</Text>
          <Text style={[styles.tdText, { flex: 1, textAlign: "right" }]}>{idr(r.sales)}</Text>
          <Text style={[styles.tdText, { flex: 1, textAlign: "right" }]}>{roasFmt(r.roas)}</Text>
        </View>
      ))}
    </View>
  );
}

export function MonthlyReportDocument({
  reportType, scopeLabel, monthLabel, generatedAt, current, previous, trend,
}: {
  reportType: ReportType;
  scopeLabel: string; // e.g. "Company-wide" | "Great Jakarta 1" | "One Stop - Sunter"
  monthLabel: string; // e.g. "Juni 2026"
  generatedAt: string;
  current: Summary;
  previous: Summary | null;
  // Last ~6 months of history up to and including the report's month,
  // scoped the same as `current` (city/store) but NOT month-filtered —
  // a month-filtered summary only ever contains that one month's bucket.
  trend: MonthPoint[];
}) {
  const titleByType: Record<ReportType, string> = {
    ceo: "Panasonic CEO — Monthly Performance Report",
    brand_manager: "Brand Manager Report",
    dealer_owner: "Dealer Owner Report",
  };
  const bullets = buildNarrative(current.kpis, previous?.kpis ?? null);

  const trendData = trend.map((m) => ({ label: (m.month || "").slice(0, 3), value: m.sales }));

  const dealersSorted = [...current.dealers].sort((a, b) => b.sales - a.sales);
  const showSplit = dealersSorted.length > 10;
  const top5 = dealersSorted.slice(0, 5).map((d) => ({ name: d.store_name, sub: d.city, sales: d.sales, roas: d.roas }));
  const bottom5 = showSplit
    ? [...dealersSorted].slice(-5).reverse().map((d) => ({ name: d.store_name, sub: d.city, sales: d.sales, roas: d.roas }))
    : [];

  const panasonicShare = current.brand_share.find((b) => b.brand?.toLowerCase() === "panasonic")?.sales ?? 0;
  const otherShare = current.brand_share.filter((b) => b.brand?.toLowerCase() !== "panasonic").reduce((s, b) => s + b.sales, 0);
  const totalShare = panasonicShare + otherShare || 1;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{titleByType[reportType]}</Text>
          <Text style={styles.subtitle}>{scopeLabel} · {monthLabel}</Text>
        </View>

        {/* KPI summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Metrics</Text>
          <View style={styles.kpiGrid}>
            <KpiCard label="Panasonic Sales" val={idr(current.kpis.sales)} delta={deltaLabel(current.kpis.sales, previous?.kpis.sales)} />
            <KpiCard label="Total GMV" val={idr(current.kpis.gmv)} delta={deltaLabel(current.kpis.gmv, previous?.kpis.gmv)} />
            <KpiCard label="Traffic" val={compact(current.kpis.traffic)} delta={deltaLabel(current.kpis.traffic, previous?.kpis.traffic)} />
            <KpiCard label="In-Cart" val={compact(current.kpis.in_cart)} delta={deltaLabel(current.kpis.in_cart, previous?.kpis.in_cart)} />
            <KpiCard label="Ads Cost" val={idr(current.kpis.ad_cost)} delta={deltaLabel(current.kpis.ad_cost, previous?.kpis.ad_cost)} />
            <KpiCard label="ROAS" val={roasFmt(current.kpis.roas)} delta={current.kpis.roas != null && previous?.kpis.roas != null ? deltaLabel(current.kpis.roas, previous.kpis.roas) : "no prior data"} />
          </View>
        </View>

        {/* Narrative */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Analysis</Text>
          {bullets.map((b, i) => (
            <View style={styles.bullet} key={i}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>

        {/* Trend chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sales Trend (last {trendData.length} months)</Text>
          <BarChartSvg data={trendData} />
        </View>

        {/* Dealer ranking OR top products */}
        {reportType === "dealer_owner" ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Products This Month</Text>
            <View style={styles.table}>
              <View style={styles.th}>
                <Text style={[styles.thText, { flex: 3 }]}>Product</Text>
                <Text style={[styles.thText, { flex: 1, textAlign: "right" }]}>Sales</Text>
              </View>
              {current.top_products.slice(0, 10).map((p, i) => (
                <View style={styles.tr} key={i}>
                  <Text style={[styles.tdText, { flex: 3 }]}>{p.name}</Text>
                  <Text style={[styles.tdText, { flex: 1, textAlign: "right" }]}>{idr(p.sales)}</Text>
                </View>
              ))}
              {!current.top_products.length && <Text style={{ fontSize: 9, color: MUTED }}>No product data for this period.</Text>}
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Dealer Performance</Text>
            {showSplit ? (
              <>
                <RankTable title="Top 5 Dealers" rows={top5} />
                <RankTable title="Bottom 5 Dealers" rows={bottom5} />
              </>
            ) : (
              <RankTable title={`All Dealers (${dealersSorted.length})`} rows={top5.concat(dealersSorted.slice(5).map((d) => ({ name: d.store_name, sub: d.city, sales: d.sales, roas: d.roas })))} />
            )}
          </View>
        )}

        {/* Brand mix + category, only meaningful above single-store granularity */}
        {reportType !== "dealer_owner" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Brand Mix</Text>
            <Text style={{ fontSize: 9 }}>
              Panasonic {((panasonicShare / totalShare) * 100).toFixed(0)}% · Other {((otherShare / totalShare) * 100).toFixed(0)}%
            </Text>
          </View>
        )}

        <Text style={styles.footer} fixed>
          Generated {generatedAt} · Reline Dashboard · Panasonic Marketplace Performance
        </Text>
      </Page>
    </Document>
  );
}

function KpiCard({ label, val, delta }: { label: string; val: string; delta: string }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiVal}>{val}</Text>
      <Text style={styles.kpiDelta}>{delta}</Text>
    </View>
  );
}

// Register the default Helvetica font family explicitly (react-pdf ships it
// built-in, but being explicit avoids a font-resolution warning in some
// serverless environments).
Font.register({ family: "Helvetica", fonts: [{ src: "Helvetica" }] });
