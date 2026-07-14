"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import nextDynamic from "next/dynamic";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

// Lazy-load the recharts-backed charts (~390 KB) so they're fetched in a
// separate chunk AFTER the filters + KPI cards paint, rather than blocking
// the initial render of the app's landing page. ssr:false is valid here
// because this is a Client Component; ResponsiveContainer needs the DOM
// anyway. A shimmer placeholder holds the chart's height to avoid layout
// shift while the chunk loads.
const chartLoading = () => <div className="ske" style={{ width: "100%", height: 300, borderRadius: 8 }} />;
const BarsChart    = nextDynamic(() => import("./DashboardCharts").then((m) => m.BarsChart),    { ssr: false, loading: chartLoading });
const HBarChart    = nextDynamic(() => import("./DashboardCharts").then((m) => m.HBarChart),    { ssr: false, loading: chartLoading });
const Donut        = nextDynamic(() => import("./DashboardCharts").then((m) => m.Donut),        { ssr: false, loading: chartLoading });
const CostRoas     = nextDynamic(() => import("./DashboardCharts").then((m) => m.CostRoas),     { ssr: false, loading: chartLoading });
const TrafficTrend = nextDynamic(() => import("./DashboardCharts").then((m) => m.TrafficTrend), { ssr: false, loading: chartLoading });
const BaselineChart = nextDynamic(() => import("./BaselineChart"), { ssr: false, loading: chartLoading });

type Summary = {
  kpis: { sales: number; gmv: number; traffic: number; in_cart: number; ad_cost: number; roas: number | null };
  monthly_sales: { year: number | null; month: string; sales: number }[];
  store_monthly: { year: number | null; month: string; gmv: number }[];
  top_products: { name: string; sales: number }[];
  brand_share: { brand: string; sales: number }[];
  by_category: { category: string; sales: number }[];
  cost_roas: { year: number | null; month: string; cost: number; roas: number | null }[];
  traffic_trend: { year: number | null; month: string; traffic: number; in_cart: number }[];
  dealers: { store_name: string; city: string; sales: number; traffic: number; in_cart: number; ad_cost: number; roas: number | null; trend: { year: number | null; month: string; sales: number }[] }[];
};
type DealerOpt = { value: string; city: string | null };
type Filters = { years: number[]; quarters: string[]; months: string[]; weeks: string[]; cities: string[]; dealers: DealerOpt[] };
type BaselineVsActive = {
  baseline: { stores: number; sales: number; ad_cost: number };
  active: { store_months: number; sales: number; ad_cost: number };
};

// Sortable columns on the "Detail Data per Dealer" table. cartRate isn't a
// stored field (computed client-side as in_cart/traffic), so it's added to
// each row before sorting rather than read directly off the RPC result.
type DealerSortKey = "store_name" | "city" | "sales" | "traffic" | "in_cart" | "cartRate" | "ad_cost" | "roas";
type SortDir = "asc" | "desc";

const MONTH_ORDER = ["Januari","Februari","Febuari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const QUARTER_MONTHS: Record<string, string[]> = {
  Q1: ["Januari", "Februari", "Febuari", "Maret"],
  Q2: ["April", "Mei", "Juni"],
  Q3: ["Juli", "Agustus", "September"],
  Q4: ["Oktober", "November", "Desember"],
};
const MONTH_SHORT: Record<string, string> = {
  Januari: "Jan", Februari: "Feb", Febuari: "Feb", Maret: "Mar", April: "Apr", Mei: "Mei", Juni: "Jun",
  Juli: "Jul", Agustus: "Agu", September: "Sep", Oktober: "Okt", November: "Nov", Desember: "Des",
};
// Sort chronologically by year+month, and label bars "Mon YYYY" so
// e.g. Nov 2025 renders to the left of Jan 2026 instead of alphabetically.
const byMonth = <T extends { year: number | null; month: string }>(a: T[]) =>
  [...(a || [])]
    .sort((x, y) => {
      const yx = x.year ?? 0, yy = y.year ?? 0;
      if (yx !== yy) return yx - yy;
      return MONTH_ORDER.indexOf(x.month) - MONTH_ORDER.indexOf(y.month);
    })
    .map((r) => ({ ...r, label: `${MONTH_SHORT[r.month] || r.month} ${r.year ?? ""}`.trim() }));

const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 2 }).format(n || 0);
const idrFull = (n: number) => "Rp" + new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const compact = (n: number) => {
  if (!n) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
};
const num = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));

// Collapse the full brand mix down to Panasonic vs everything else.
function panasonicVsOther(brandShare: { brand: string; sales: number }[]) {
  let panasonic = 0, other = 0;
  for (const b of brandShare) {
    if ((b.brand || "").toLowerCase() === "panasonic") panasonic += b.sales;
    else other += b.sales;
  }
  return [
    { name: "Panasonic", value: panasonic },
    { name: "Other",     value: other },
  ];
}

// Scope the Dealer dropdown to whatever City is selected (empty city = all dealers).
function dealersInCity(dealers: DealerOpt[], city: string): DealerOpt[] {
  return city ? dealers.filter((d) => d.city === city) : dealers;
}

export default function DashboardPage() {
  const [supabase] = useState(() => createClient());
  const [filters, setFilters] = useState<Filters>({ years: [], quarters: ["Q1","Q2","Q3","Q4"], months: [], weeks: [], cities: [], dealers: [] });
  const [sel, setSel] = useState({ year: "", quarter: "", month: "", week: "", city: "", dealer: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [baseline, setBaseline] = useState<BaselineVsActive | null>(null);
  const [dealerSort, setDealerSort] = useState<{ key: DealerSortKey; dir: SortDir } | null>(null);

  useEffect(() => {
    (async () => {
      // No getUser() gate here: the proxy already redirects unauthenticated
      // users away from this route, and the RPC is RLS/security-definer
      // protected — so calling it directly removes a redundant blocking auth
      // round-trip. This effect and the summary `load()` effect below both
      // fire on mount and run concurrently (neither awaits the other).
      // Read the cached filter options (refreshed on upload) instead of
      // re-scanning sales_rows for distinct year/month/week on every load.
      const { data: cached } = await supabase.rpc("get_dashboard_filters_cached");
      if (cached) { setFilters(cached as Filters); return; }
      // Fallback for before migration 20 is applied / cache is empty.
      const { data: f } = await supabase.rpc("dashboard_filters");
      if (f) setFilters(f as Filters);
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    const noFilters = !sel.year && !sel.quarter && !sel.month && !sel.week && !sel.city && !sel.dealer;
    // The unfiltered "All Time" view touches every row in sales_rows and
    // gets slower every quarter — read the cached snapshot instead of
    // recomputing it live. Any filter picked falls back to the live RPC,
    // which only scans the (much smaller) filtered slice.
    // Baseline-vs-active only respects City/Dealer (it compares Month Awal
    // vs every real month, so a Year/Month/Week filter wouldn't mean
    // anything for it) — fetched in parallel, not chained after the summary.
    const [{ data }, { data: bva }] = await Promise.all([
      noFilters
        ? supabase.rpc("get_dashboard_snapshot")
        : supabase.rpc("dashboard_summary", {
            p_year:    sel.year    ? Number(sel.year) : null,
            p_quarter: sel.quarter || null,
            p_month:   sel.month   || null,
            p_week:    sel.week    || null,
            p_city:    sel.city    || null,
            p_store:   sel.dealer  || null,
          }),
      supabase.rpc("dashboard_baseline_vs_active", {
        p_city:  sel.city   || null,
        p_store: sel.dealer || null,
      }),
    ]);
    setD(data as Summary);
    setBaseline((bva as BaselineVsActive) || null);
    setLoading(false);
  }, [supabase, sel]);
  useEffect(() => { load(); }, [load]);

  // Sortable "Detail Data per Dealer" table — click cycles desc -> asc ->
  // back to the RPC's default order (sales desc). Sorts the RAW numeric
  // fields (and a computed cartRate), never the formatted display strings.
  function toggleDealerSort(key: DealerSortKey) {
    setDealerSort((s) => {
      if (!s || s.key !== key) return { key, dir: "desc" };
      if (s.dir === "desc") return { key, dir: "asc" };
      return null;
    });
  }
  const sortedDealers = useMemo(() => {
    const rows = (d?.dealers || []).map((r) => ({ ...r, cartRate: r.traffic ? (r.in_cart / r.traffic) * 100 : 0 }));
    if (!dealerSort) return rows;
    const { key, dir } = dealerSort;
    const sign = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === "string" || typeof bv === "string") {
        return sign * String(av ?? "").localeCompare(String(bv ?? ""));
      }
      return sign * ((Number(av) || 0) - (Number(bv) || 0));
    });
  }, [d?.dealers, dealerSort]);

  const k = d?.kpis;
  const roasPct = k?.roas ? Math.min((k.roas / 5) * 100, 100) : 0;
  const cartRate = k && k.traffic ? (k.in_cart / k.traffic) * 100 : 0;

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .ske {
          display: inline-block;
          background: linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.14) 50%,rgba(255,255,255,.05) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.4s ease-in-out infinite;
          border-radius: 6px;
        }
      `}</style>

      {/* Filters — matching GAS: Year / Quarter / Month / Week / City / Dealer */}
      <div className="filterbar">
        <Sel label="Year"    value={sel.year}    onChange={(v) => setSel((s) => ({ ...s, year: v }))}    opts={filters.years.map(String)}    all="All Years" />
        <Sel label="Quarter" value={sel.quarter} onChange={(v) => setSel((s) => ({ ...s, quarter: v, month: QUARTER_MONTHS[v]?.includes(s.month) ? s.month : "" }))} opts={filters.quarters} all="All Quarters" />
        <Sel label="Month"   value={sel.month}   onChange={(v) => setSel((s) => ({ ...s, month: v }))}   opts={sel.quarter ? filters.months.filter((m) => QUARTER_MONTHS[sel.quarter]?.includes(m)) : filters.months}   all="All Months" />
        <Sel label="Week"    value={sel.week}    onChange={(v) => setSel((s) => ({ ...s, week: v }))}    opts={filters.weeks}                all="All Weeks" />
        <Sel label="City"    value={sel.city}    onChange={(v) => setSel((s) => ({ ...s, city: v, dealer: dealersInCity(filters.dealers, v).some((d) => d.value === s.dealer) ? s.dealer : "" }))} opts={filters.cities} all="All Cities" />
        <Sel label="Dealer"  value={sel.dealer}  onChange={(v) => setSel((s) => ({ ...s, dealer: v }))}  opts={dealersInCity(filters.dealers, sel.city).map((d) => d.value)} all="All Dealers" />
        <button className="btn-ghost" onClick={() => setSel({ year: "", quarter: "", month: "", week: "", city: "", dealer: "" })}>Reset</button>
        {loading && (
          <span style={{ alignSelf: "center", display: "flex", alignItems: "center", gap: 6, color: "var(--gold)", fontSize: 12 }}>
            <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(201,162,39,.3)", borderTopColor: "#c9a227", animation: "spin .7s linear infinite" }} />
            Memuat data…
          </span>
        )}
      </div>

      {/* KPIs */}
      <div style={{ position: "relative" }}>
        {/* Full overlay spinner — only on initial load (no data yet) */}
        {loading && !d && (
          <div style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(10,22,40,.6)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 12, gap: 12, backdropFilter: "blur(3px)" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid rgba(201,162,39,.25)", borderTopColor: "#c9a227", animation: "spin .8s linear infinite" }} />
            <span style={{ color: "var(--gold)", fontSize: 13 }}>Memuat data…</span>
          </div>
        )}
        <div className="kpi-grid" style={{ opacity: loading && d ? 0.55 : 1, transition: "opacity .2s" }}>
          <div className="kpi kpi-hero"><div className="kpi-icon">💰</div><div className="lbl">Panasonic Sales</div><div className="val">{!k && loading ? <span className="ske" style={{ width: 140, height: 36 }} /> : k ? idr(k.sales) : "—"}</div><div className="kpi-sub">{k ? idrFull(k.sales) : "SPOS · Siap Dikirim"}</div></div>
          <div className="kpi"><div className="kpi-icon">🏪</div><div className="lbl">Total GMV</div><div className="val">{!k && loading ? <span className="ske" style={{ width: 130, height: 36 }} /> : k ? idr(k.gmv) : "—"}</div><div className="kpi-sub">{k ? idrFull(k.gmv) : "Performa"}</div></div>
          <div className="kpi"><div className="kpi-icon">👁</div><div className="lbl">Pana Traffic</div><div className="val">{!k && loading ? <span className="ske" style={{ width: 80, height: 36 }} /> : k ? compact(k.traffic) : "—"}</div></div>
          <div className="kpi"><div className="kpi-icon">🛒</div><div className="lbl">Pana In-Cart</div><div className="val">{!k && loading ? <span className="ske" style={{ width: 80, height: 36 }} /> : k ? compact(k.in_cart) : "—"}</div><div className="kpi-sub">{k ? cartRate.toFixed(1) + "% cart rate" : ""}</div></div>
          <div className="kpi"><div className="kpi-icon">📣</div><div className="lbl">Ads Cost</div><div className="val">{!k && loading ? <span className="ske" style={{ width: 110, height: 36 }} /> : k ? idr(k.ad_cost) : "—"}</div></div>
          <div className="kpi kpi-roas"><div className="kpi-icon">⚡</div><div className="lbl">ROAS</div><div className="val">{!k && loading ? <span className="ske" style={{ width: 70, height: 36 }} /> : k && k.roas ? k.roas.toFixed(2) + "×" : "—"}</div><div className="roas-bar"><div className="roas-fill" style={{ width: roasPct + "%" }} /></div></div>
        </div>
      </div>

      {/* Monthly sales */}
      <div className="row">
        <Panel title="Panasonic Monthly Sales" hint="Penjualan Siap Dikirim per bulan · SPOS">
          <BarsChart data={byMonth(d?.monthly_sales || [])} x="label" y="sales" color="#c9a227" />
        </Panel>
      </div>

      {/* Top products + brand share */}
      <div className="row c2">
        <Panel title="Top 10 Best-Selling Products" hint="Sales · parent rows only">
          <HBarChart data={d?.top_products || []} />
        </Panel>
        <Panel title="Brand Share of Sales" hint="Panasonic vs Other · SPOS">
          <Donut data={panasonicVsOther(d?.brand_share || [])} colors={["#c9a227", "#3b6ea5"]} />
        </Panel>
      </div>

      {/* Cost vs ROAS + traffic trend */}
      <div className="row c2b">
        <Panel title="Monthly Ads Cost vs ROAS" hint="Columns = cost · line = ROAS">
          <CostRoas data={byMonth(d?.cost_roas || [])} />
        </Panel>
        <Panel title="Traffic vs Add-to-Cart" hint="Funnel trend per month">
          <TrafficTrend data={byMonth(d?.traffic_trend || [])} />
        </Panel>
      </div>

      {/* Store monthly */}
      <div className="row">
        <Panel title="Store Sales by Month" hint="All brands GMV · Performa">
          <BarsChart data={byMonth(d?.store_monthly || [])} x="label" y="gmv" color="#1e4a7a" />
        </Panel>
      </div>

      {/* Category + category share */}
      <div className="row c2">
        <Panel title="Sales by Category" hint="SPOS · product type">
          <BarsChart data={d?.by_category || []} x="category" y="sales" color="#e8c84a" />
        </Panel>
        <Panel title="Category Share (%)" hint="Sales mix by category">
          <Donut data={(d?.by_category || []).map((c) => ({ name: c.category, value: c.sales }))} />
        </Panel>
      </div>

      {/* Baseline vs Active */}
      <div className="row">
        <BaselineChart data={baseline} />
      </div>

      {/* Dealer table */}
      <div className="panel">
        <h3>Detail Data per Dealer</h3>
        <div className="hint">{dealerSort ? `Sorted by ${dealerSort.key} (${dealerSort.dir})` : "Sorted by sales · click a column to sort"}</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead><tr>
              <SortableTh label="Dealer" sortKey="store_name" sort={dealerSort} onSort={toggleDealerSort} align="left" />
              <th style={{ width: 90 }}>Trend</th>
              <SortableTh label="City" sortKey="city" sort={dealerSort} onSort={toggleDealerSort} align="left" />
              <SortableTh label="Sales" sortKey="sales" sort={dealerSort} onSort={toggleDealerSort} />
              <SortableTh label="Traffic" sortKey="traffic" sort={dealerSort} onSort={toggleDealerSort} />
              <SortableTh label="In-Cart" sortKey="in_cart" sort={dealerSort} onSort={toggleDealerSort} />
              <SortableTh label="Cart Rate" sortKey="cartRate" sort={dealerSort} onSort={toggleDealerSort} />
              <SortableTh label="Ads Cost" sortKey="ad_cost" sort={dealerSort} onSort={toggleDealerSort} />
              <SortableTh label="ROAS" sortKey="roas" sort={dealerSort} onSort={toggleDealerSort} />
            </tr></thead>
            <tbody>
              {sortedDealers.map((r, i) => (
                <tr key={i}>
                  <td>{r.store_name}</td>
                  <td><Sparkline id={`spark-${i}`} points={(r.trend || []).map((t) => t.sales)} /></td>
                  <td>{r.city || "—"}</td>
                  <td className="num">{idr(r.sales)}</td>
                  <td className="num">{num(r.traffic)}</td>
                  <td className="num">{num(r.in_cart)}</td>
                  <td className="num">{r.cartRate.toFixed(1)}%</td>
                  <td className="num">{idr(r.ad_cost)}</td>
                  <td className="num"><span className={`pill ${!r.roas ? "" : r.roas >= 3 ? "good" : r.roas >= 1 ? "warn" : "bad"}`}>{r.roas ? r.roas.toFixed(2) + "×" : "—"}</span></td>
                </tr>
              ))}
              {sortedDealers.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No data yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------- building blocks ---------- */
function SortableTh({ label, sortKey, sort, onSort, align = "right" }: {
  label: string; sortKey: DealerSortKey; sort: { key: DealerSortKey; dir: SortDir } | null;
  onSort: (k: DealerSortKey) => void; align?: "left" | "right";
}) {
  const active = sort?.key === sortKey;
  const Icon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={align === "right" ? "num" : undefined} style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSort(sortKey)}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: align === "right" ? "flex-end" : "flex-start", width: "100%" }}>
        {align === "left" && <Icon size={12} style={{ opacity: active ? 1 : 0.4, flexShrink: 0 }} />}
        {label}
        {align === "right" && <Icon size={12} style={{ opacity: active ? 1 : 0.4, flexShrink: 0 }} />}
      </span>
    </th>
  );
}
function Sel({ label, value, onChange, opts, all }: { label: string; value: string; onChange: (v: string) => void; opts: (string | number)[]; all: string }) {
  return (
    <div className="fld"><label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {opts.map((o) => <option key={String(o)} value={String(o)}>{o}</option>)}
      </select>
    </div>
  );
}
function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <div className="panel"><h3>{title}</h3><div className="hint">{hint}</div>{children}</div>;
}

// Small SPOS Panasonic sales trend chart, own column next to City.
// Green when the latest period is >= the first, red when it's down.
// Styled to match the "3D" gradient-fill + glow look used on the main charts.
function Sparkline({ id, points, width = 84, height = 30 }: { id: string; points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <span style={{ display: "inline-block", width, height }} />;
  const pad = 4; // room for the end-point glow dot so it isn't clipped
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => [pad + i * stepX, pad + (height - pad * 2) * (1 - (p - min) / range)] as const);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1][0].toFixed(1)} ${height} L ${coords[0][0].toFixed(1)} ${height} Z`;
  const up = points[points.length - 1] >= points[0];
  const color = up ? "#4ade80" : "#f87171";
  const [lastX, lastY] = coords[coords.length - 1];
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.45} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
        <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.4" floodColor={color} floodOpacity="0.85" />
        </filter>
      </defs>
      <path d={areaPath} fill={`url(#${id}-fill)`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ filter: `url(#${id}-glow)` }} />
      <circle cx={lastX} cy={lastY} r={2.4} fill={color} style={{ filter: `url(#${id}-glow)` }} />
    </svg>
  );
}
