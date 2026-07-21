"use client";

// Ads Performance Dashboard — ported (adapted) from the ProfTokoOnline
// blueprint's AdsOverview. Reads the new ads_dashboard_summary() RPC
// (Supabase Migration/30). Reline conventions: City/Dealer filter cascade
// from master_data (not owner/store_links); Reline's existing green/yellow/
// red ROAS palette (not the blueprint's gold/blue-only rule, per the
// approved decision). Every ROAS comes from the server as
// SUM(sales)/NULLIF(SUM(ad_cost),0) — never recomputed/averaged here.
//
// Lazy-loaded via next/dynamic from the /ads page so recharts stays out of
// that page's initial bundle.
import { useEffect, useState, useMemo, useCallback } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ── types ── */
type Bucketed = { ad_cost: number; sales: number; view: number; click: number; orders: number; item_sold: number; roas: number | null };
type GroupRow = { nama_iklan: string; ad_cost: number; sales: number; roas: number | null; view: number; click: number; orders: number; item_sold: number };
type ProductRow = { kode_produk: string; nama_produk: string | null; ad_cost: number; sales: number; roas: number | null; view: number; click: number; orders: number; item_sold: number };
type Summary = {
  totals: { total: Bucketed; gmv_max: Bucketed; group_ads: Bucketed; independent: Bucketed };
  funnel: { view: number; click: number; add_to_cart: number; orders: number };
  monthly: { bucket: string; gmv_max_sales: number; group_sales: number; independent_sales: number; roas: number | null }[];
  sold_sales_trend: { bucket: string; item_sold: number; sales: number }[];
  groups: GroupRow[];
  products: ProductRow[];
};
type AdsFilters = { years: number[]; months: string[] };

/* ── format ── */
const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const roasF = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : n.toFixed(2) + "×");
const roasColor = (n: number | null | undefined) => (n == null ? "var(--muted)" : n > 5 ? "#4ade80" : n >= 2 ? "#fbbf24" : "#f87171");
const MONTH_ORDER = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

const tooltip = { background: "#0f2040", border: "1px solid rgba(201,162,39,.3)", borderRadius: 8, color: "#e8edf8", fontSize: 12 };
const axis = { fontSize: 10, fill: "#94a3b8" };

export default function AdsOverview() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [filters, setFilters] = useState<AdsFilters>({ years: [], months: [] });
  const [cities, setCities] = useState<string[]>([]);
  const [dealersByCity, setDealersByCity] = useState<Record<string, string[]>>({});
  const [sel, setSel] = useState({ year: "", month: "", city: "", dealer: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // filter options: ads year/month from the RPC + City/Dealer from master_data.
  useEffect(() => {
    (async () => {
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);
      const [{ data: f }, { data: stores }] = await Promise.all([
        supabase.rpc("ads_dashboard_filters"),
        supabase.from("master_data").select("value,city").eq("kind", "store").eq("client_id", cid).order("value"),
      ]);
      if (f) setFilters(f as AdsFilters);
      const byCity: Record<string, string[]> = {};
      for (const s of (stores as { value: string; city: string | null }[]) || []) {
        const c = s.city || "—";
        (byCity[c] ||= []).push(s.value);
      }
      setDealersByCity(byCity);
      setCities(Object.keys(byCity).filter((c) => c !== "—").sort());
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const { data, error } = await supabase.rpc("ads_dashboard_summary", {
      p_year:  sel.year  ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_city:  sel.city  || null,
      p_store: sel.dealer || null,
    });
    if (error) setErr(error.message);
    else setD(data as Summary);
    setLoading(false);
  }, [supabase, sel]);
  useEffect(() => { void load(); }, [load]);

  const months = useMemo(() => [...filters.months].sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b)), [filters.months]);
  const weekly = !!sel.month; // charts switch to weekly buckets when a month is picked
  const t = d?.totals;

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
        <div>
          <h3 style={{ margin: 0 }}>Ads Overview</h3>
          <div className="hint">Panasonic Ads · Total / GMV Max / Group / Independent · ROAS = Sales ÷ Ad Cost (server-side)</div>
        </div>
      </div>

      {/* filter bar */}
      <div className="filterbar" style={{ marginTop: 14, marginBottom: 6 }}>
        <Sel label="Year" value={sel.year} onChange={(v) => setSel((s) => ({ ...s, year: v }))} opts={filters.years.map(String)} all="All Years" />
        <Sel label="Month" value={sel.month} onChange={(v) => setSel((s) => ({ ...s, month: v }))} opts={months} all="All Months" />
        <Sel label="City" value={sel.city} onChange={(v) => setSel((s) => ({ ...s, city: v, dealer: "" }))} opts={cities} all="All Cities" />
        <Sel label="Dealer" value={sel.dealer} onChange={(v) => setSel((s) => ({ ...s, dealer: v }))} opts={sel.city ? (dealersByCity[sel.city] || []) : Object.values(dealersByCity).flat()} all="All Dealers" />
        <button className="btn-ghost" onClick={() => setSel({ year: "", month: "", city: "", dealer: "" })}>Reset</button>
        {loading && <span style={{ alignSelf: "center", color: "var(--gold)", fontSize: 12 }}>Memuat…</span>}
      </div>

      {err && (
        <div style={{ padding: 12, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 10, fontSize: 12, color: "#fca5a5", marginTop: 10, fontFamily: "monospace" }}>⚠ {err}</div>
      )}

      {/* 7-KPI grid — Total Ads */}
      <div className="kpi-grid" style={{ marginTop: 14, gridTemplateColumns: "repeat(7,1fr)" }}>
        <Kpi label="Ads Cost" val={t ? idr(t.total.ad_cost) : "—"} />
        <Kpi label="Sales" val={t ? idr(t.total.sales) : "—"} hero />
        <Kpi label="ROAS" val={roasF(t?.total.roas)} gold />
        <Kpi label="View" val={t ? num(t.total.view) : "—"} />
        <Kpi label="Click" val={t ? num(t.total.click) : "—"} />
        <Kpi label="Order" val={t ? num(t.total.orders) : "—"} />
        <Kpi label="Item Sold" val={t ? num(t.total.item_sold) : "—"} />
      </div>

      {/* 3 category cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 16 }}>
        <CategoryCard title="GMV Max Auto" c={t?.gmv_max} color="#3b82f6" />
        <CategoryCard title="Group Ads" c={t?.group_ads} color="#60a5fa" />
        <CategoryCard title="Independent Ads" c={t?.independent} color="#93c5fd" />
      </div>

      {/* charts */}
      <div className="row c2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3 style={{ margin: "0 0 2px" }}>Sales by Ads Type{weekly ? " · Weekly" : ""}</h3>
          <div className="hint" style={{ marginBottom: 14 }}>Stacked sales · ROAS line (right)</div>
          <SalesByType data={d?.monthly || []} />
        </div>
        <div className="panel">
          <h3 style={{ margin: "0 0 2px" }}>Ads Funnel</h3>
          <div className="hint" style={{ marginBottom: 14 }}>View → Click → Add to Cart → Order</div>
          <AdsFunnel f={d?.funnel} />
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3 style={{ margin: "0 0 2px" }}>Item Sold vs Sales{weekly ? " · Weekly" : ""}</h3>
          <div className="hint" style={{ marginBottom: 14 }}>Item sold (left) · Sales (right)</div>
          <SoldVsSales data={d?.sold_sales_trend || []} />
        </div>
      </div>

      {/* Ads Group Performance table */}
      <GroupTable rows={d?.groups || []} loading={loading} />
      {/* Ads Product Performance table */}
      <ProductTable rows={d?.products || []} loading={loading} />
    </div>
  );
}

/* ── KPI + card + filter primitives ── */
function Kpi({ label, val, hero, gold }: { label: string; val: string; hero?: boolean; gold?: boolean }) {
  return (
    <div className={`kpi${hero ? " kpi-hero" : ""}${gold ? " kpi-roas" : ""}`}>
      <div className="lbl">{label}</div>
      <div className="val" style={gold ? { color: "var(--gold)" } : undefined}>{val}</div>
    </div>
  );
}
function CategoryCard({ title, c, color }: { title: string; c?: Bucketed; color: string }) {
  return (
    <div className="panel" style={{ padding: 16, borderTop: `2px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, color: "#e8edf8", fontSize: 14 }}>{title}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: roasColor(c?.roas) }}>{roasF(c?.roas)}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginBottom: 10 }}>{c ? idr(c.ad_cost) : "—"}<span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 400 }}> ads cost</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, fontSize: 11 }}>
        <Mini label="Sales" val={c ? idr(c.sales) : "—"} />
        <Mini label="View" val={c ? num(c.view) : "—"} />
        <Mini label="Click" val={c ? num(c.click) : "—"} />
        <Mini label="Order" val={c ? num(c.orders) : "—"} />
        <Mini label="Item Sold" val={c ? num(c.item_sold) : "—"} />
      </div>
    </div>
  );
}
function Mini({ label, val }: { label: string; val: string }) {
  return <div><div style={{ color: "var(--muted)", fontSize: 9.5, textTransform: "uppercase" }}>{label}</div><div style={{ color: "#e8edf8", fontWeight: 600 }}>{val}</div></div>;
}
function Sel({ label, value, onChange, opts, all }: { label: string; value: string; onChange: (v: string) => void; opts: string[]; all: string }) {
  return (
    <div className="fld"><label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/* ── charts ── */
function SalesByType({ data }: { data: Summary["monthly"] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 4, right: 8, top: 6, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey="bucket" tick={axis} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={54} />
          <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={34} />
          <Tooltip contentStyle={tooltip} formatter={(v, n) => n === "roas" ? [roasF(Number(v)), "ROAS"] : [idr(Number(v)), String(n)]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
          <Legend wrapperStyle={{ fontSize: 10.5 }} iconType="circle" iconSize={8} />
          <Bar yAxisId="l" dataKey="gmv_max_sales" name="GMV Max" stackId="s" fill="#3b82f6" />
          <Bar yAxisId="l" dataKey="group_sales" name="Group" stackId="s" fill="#60a5fa" />
          <Bar yAxisId="l" dataKey="independent_sales" name="Independent" stackId="s" fill="#93c5fd" radius={[4, 4, 0, 0]} />
          <Line yAxisId="r" type="monotone" dataKey="roas" name="roas" stroke="#c9a227" strokeWidth={2.5} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
function SoldVsSales({ data }: { data: Summary["sold_sales_trend"] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 4, right: 8, top: 6, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey="bucket" tick={axis} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={axis} tickFormatter={(v) => num(Number(v))} axisLine={false} tickLine={false} width={48} />
          <YAxis yAxisId="r" orientation="right" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={54} />
          <Tooltip contentStyle={tooltip} formatter={(v, n) => n === "sales" ? [idr(Number(v)), "Sales"] : [num(Number(v)), "Item Sold"]} />
          <Legend wrapperStyle={{ fontSize: 10.5 }} iconType="circle" iconSize={8} />
          <Line yAxisId="l" type="monotone" dataKey="item_sold" name="item_sold" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} />
          <Line yAxisId="r" type="monotone" dataKey="sales" name="sales" stroke="#c9a227" strokeWidth={2.5} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Custom SVG trapezoid funnel — blue→gold, % of top stage per segment.
function AdsFunnel({ f }: { f?: Summary["funnel"] }) {
  if (!f) return <Empty />;
  const stages = [
    { label: "View", value: f.view, color: "#3b82f6" },
    { label: "Click", value: f.click, color: "#60a5fa" },
    { label: "Add to Cart", value: f.add_to_cart, color: "#93c5fd" },
    { label: "Order", value: f.orders, color: "#c9a227" },
  ];
  const top = stages[0].value || 1;
  const W = 320, H = 260, gap = 8, segH = (H - gap * (stages.length - 1)) / stages.length;
  const widthOf = (v: number) => Math.max((v / top) * W, 24);
  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: "100%" }}>
        {stages.map((s, i) => {
          const wTop = widthOf(s.value);
          const wBot = widthOf(stages[i + 1]?.value ?? s.value);
          const y = i * (segH + gap);
          const x1 = (W - wTop) / 2, x2 = (W + wTop) / 2;
          const x3 = (W + wBot) / 2, x4 = (W - wBot) / 2;
          const pctTop = ((s.value / top) * 100).toFixed(1);
          return (
            <g key={s.label}>
              <polygon points={`${x1},${y} ${x2},${y} ${x3},${y + segH} ${x4},${y + segH}`} fill={s.color} opacity={0.9} />
              <text x={W / 2} y={y + segH / 2 - 3} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={700}>{s.label}</text>
              <text x={W / 2} y={y + segH / 2 + 12} textAnchor="middle" fill="rgba(255,255,255,.85)" fontSize={11}>{num(s.value)} ({pctTop}%)</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
function Empty() { return <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>No data yet</div>; }

/* ── sortable tables ── */
function useSort<T extends Record<string, unknown>>(rows: T[]) {
  const [sort, setSort] = useState<{ key: keyof T; dir: "asc" | "desc" } | null>(null);
  const toggle = (key: keyof T) => setSort((s) => (!s || s.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null));
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort; const sign = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === "string" || typeof bv === "string") return sign * String(av ?? "").localeCompare(String(bv ?? ""));
      return sign * ((Number(av) || 0) - (Number(bv) || 0));
    });
  }, [rows, sort]);
  return { sorted, sort, toggle };
}
function Th<T>({ label, k, sort, onSort, align = "right", maxWidth }: { label: string; k: keyof T; sort: { key: keyof T; dir: "asc" | "desc" } | null; onSort: (k: keyof T) => void; align?: "left" | "right"; maxWidth?: number }) {
  const active = sort?.key === k;
  const Icon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={align === "right" ? "num" : undefined} style={{ cursor: "pointer", userSelect: "none", ...(maxWidth ? { maxWidth } : {}) }} onClick={() => onSort(k)}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: align === "right" ? "flex-end" : "flex-start", width: "100%" }}>
        {align === "left" && <Icon size={12} style={{ opacity: active ? 1 : 0.4, flexShrink: 0 }} />}{label}{align === "right" && <Icon size={12} style={{ opacity: active ? 1 : 0.4, flexShrink: 0 }} />}
      </span>
    </th>
  );
}
function GroupTable({ rows, loading }: { rows: GroupRow[]; loading: boolean }) {
  const { sorted, sort, toggle } = useSort(rows as unknown as Record<string, unknown>[]);
  return (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ margin: "0 0 8px" }}>Ads Group Performance</h3>
      <div className="tbl-wrap" style={{ maxHeight: 360 }}>
        <table className="tbl">
          <thead><tr>
            <Th<GroupRow> label="Campaign Name" k="nama_iklan" sort={sort as never} onSort={toggle as never} align="left" />
            <Th<GroupRow> label="Ads Cost" k="ad_cost" sort={sort as never} onSort={toggle as never} />
            <Th<GroupRow> label="Sales" k="sales" sort={sort as never} onSort={toggle as never} />
            <Th<GroupRow> label="ROAS" k="roas" sort={sort as never} onSort={toggle as never} />
            <Th<GroupRow> label="View" k="view" sort={sort as never} onSort={toggle as never} />
            <Th<GroupRow> label="Click" k="click" sort={sort as never} onSort={toggle as never} />
            <Th<GroupRow> label="Order" k="orders" sort={sort as never} onSort={toggle as never} />
            <Th<GroupRow> label="Item Sold" k="item_sold" sort={sort as never} onSort={toggle as never} />
          </tr></thead>
          <tbody>
            {(sorted as unknown as GroupRow[]).map((r, i) => (
              <tr key={i}>
                <td>{r.nama_iklan}</td>
                <td className="num">{idr(r.ad_cost)}</td>
                <td className="num">{idr(r.sales)}</td>
                <td className="num" style={{ color: roasColor(r.roas), fontWeight: 700 }}>{roasF(r.roas)}</td>
                <td className="num">{num(r.view)}</td>
                <td className="num">{num(r.click)}</td>
                <td className="num">{num(r.orders)}</td>
                <td className="num">{num(r.item_sold)}</td>
              </tr>
            ))}
            {!loading && sorted.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No Ads Group data yet — upload a GMV Max / Group export.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function ProductTable({ rows, loading }: { rows: ProductRow[]; loading: boolean }) {
  const { sorted, sort, toggle } = useSort(rows as unknown as Record<string, unknown>[]);
  return (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ margin: "0 0 8px" }}>Ads Product Performance</h3>
      <div className="tbl-wrap" style={{ maxHeight: 440 }}>
        <table className="tbl">
          <thead><tr>
            <Th<ProductRow> label="Product Code" k="kode_produk" sort={sort as never} onSort={toggle as never} align="left" />
            <Th<ProductRow> label="Product Name" k="nama_produk" sort={sort as never} onSort={toggle as never} align="left" maxWidth={240} />
            <Th<ProductRow> label="Ads Cost" k="ad_cost" sort={sort as never} onSort={toggle as never} />
            <Th<ProductRow> label="Sales" k="sales" sort={sort as never} onSort={toggle as never} />
            <Th<ProductRow> label="ROAS" k="roas" sort={sort as never} onSort={toggle as never} />
            <Th<ProductRow> label="View" k="view" sort={sort as never} onSort={toggle as never} />
            <Th<ProductRow> label="Click" k="click" sort={sort as never} onSort={toggle as never} />
            <Th<ProductRow> label="Order" k="orders" sort={sort as never} onSort={toggle as never} />
            <Th<ProductRow> label="Item Sold" k="item_sold" sort={sort as never} onSort={toggle as never} />
          </tr></thead>
          <tbody>
            {(sorted as unknown as ProductRow[]).map((r, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.kode_produk}</td>
                <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.nama_produk || ""}>{r.nama_produk || "—"}</td>
                <td className="num">{idr(r.ad_cost)}</td>
                <td className="num">{idr(r.sales)}</td>
                <td className="num" style={{ color: roasColor(r.roas), fontWeight: 700 }}>{roasF(r.roas)}</td>
                <td className="num">{num(r.view)}</td>
                <td className="num">{num(r.click)}</td>
                <td className="num">{num(r.orders)}</td>
                <td className="num">{num(r.item_sold)}</td>
              </tr>
            ))}
            {!loading && sorted.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No product data yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
