"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, LineChart, PieChart, Pie, Cell, Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Summary = {
  kpis: { sales: number; gmv: number; traffic: number; in_cart: number; ad_cost: number; roas: number | null };
  monthly_sales: { month: string; sales: number }[];
  store_monthly: { month: string; gmv: number }[];
  top_products: { name: string; sales: number }[];
  brand_share: { brand: string; sales: number }[];
  by_category: { category: string; sales: number }[];
  cost_roas: { month: string; cost: number; roas: number | null }[];
  traffic_trend: { month: string; traffic: number; in_cart: number }[];
  dealers: { store_name: string; city: string; sales: number; traffic: number; in_cart: number; ad_cost: number; roas: number | null }[];
};
type Filters = { years: number[]; quarters: string[]; months: string[]; weeks: string[]; cities: string[]; dealers: string[] };

const MONTH_ORDER = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const byMonth = <T extends { month: string }>(a: T[]) =>
  [...(a || [])].sort((x, y) => MONTH_ORDER.indexOf(x.month) - MONTH_ORDER.indexOf(y.month));

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
const PALETTE = ["#c9a227", "#e8c84a", "#94a3b8", "#1e4a7a", "#3b6ea5", "#d4b94e", "#6b8cae", "#0f2040"];

export default function DashboardPage() {
  const [supabase] = useState(() => createClient());
  const [filters, setFilters] = useState<Filters>({ years: [], quarters: ["Q1","Q2","Q3","Q4"], months: [], weeks: [], cities: [], dealers: [] });
  const [sel, setSel] = useState({ year: "", quarter: "", month: "", week: "", city: "", dealer: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: f } = await supabase.rpc("dashboard_filters");
      if (f) setFilters(f as Filters);
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("dashboard_summary", {
      p_year:    sel.year    ? Number(sel.year) : null,
      p_quarter: sel.quarter || null,
      p_month:   sel.month   || null,
      p_week:    sel.week    || null,
      p_city:    sel.city    || null,
      p_store:   sel.dealer  || null,
    });
    setD(data as Summary);
    setLoading(false);
  }, [supabase, sel]);
  useEffect(() => { load(); }, [load]);

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
        <Sel label="Quarter" value={sel.quarter} onChange={(v) => setSel((s) => ({ ...s, quarter: v }))} opts={filters.quarters}             all="All Quarters" />
        <Sel label="Month"   value={sel.month}   onChange={(v) => setSel((s) => ({ ...s, month: v }))}   opts={filters.months}               all="All Months" />
        <Sel label="Week"    value={sel.week}    onChange={(v) => setSel((s) => ({ ...s, week: v }))}    opts={filters.weeks}                all="All Weeks" />
        <Sel label="City"    value={sel.city}    onChange={(v) => setSel((s) => ({ ...s, city: v }))}    opts={filters.cities}               all="All Cities" />
        <Sel label="Dealer"  value={sel.dealer}  onChange={(v) => setSel((s) => ({ ...s, dealer: v }))}  opts={filters.dealers}              all="All Dealers" />
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
          <BarsChart data={byMonth(d?.monthly_sales || [])} x="month" y="sales" color="#c9a227" />
        </Panel>
      </div>

      {/* Top products + brand share */}
      <div className="row c2">
        <Panel title="Top 10 Best-Selling Products" hint="Sales · parent rows only">
          <HBarChart data={d?.top_products || []} />
        </Panel>
        <Panel title="Brand Share of Sales" hint="Sales mix by brand · SPOS">
          <Donut data={(d?.brand_share || []).map((b) => ({ name: b.brand, value: b.sales }))} />
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
          <BarsChart data={byMonth(d?.store_monthly || [])} x="month" y="gmv" color="#1e4a7a" />
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

      {/* Dealer table */}
      <div className="panel">
        <h3>Detail Data per Dealer</h3>
        <div className="hint">Sorted by sales</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead><tr>
              <th>Dealer</th><th>City</th><th className="num">Sales</th><th className="num">Traffic</th>
              <th className="num">In-Cart</th><th className="num">Cart Rate</th><th className="num">Ads Cost</th><th className="num">ROAS</th>
            </tr></thead>
            <tbody>
              {(d?.dealers || []).map((r, i) => {
                const cr = r.traffic ? (r.in_cart / r.traffic) * 100 : 0;
                return (
                  <tr key={i}>
                    <td>{r.store_name}</td><td>{r.city || "—"}</td>
                    <td className="num">{idr(r.sales)}</td>
                    <td className="num">{num(r.traffic)}</td>
                    <td className="num">{num(r.in_cart)}</td>
                    <td className="num">{cr.toFixed(1)}%</td>
                    <td className="num">{idr(r.ad_cost)}</td>
                    <td className="num"><span className={`pill ${!r.roas ? "" : r.roas >= 3 ? "good" : r.roas >= 1 ? "warn" : "bad"}`}>{r.roas ? r.roas.toFixed(2) + "×" : "—"}</span></td>
                  </tr>
                );
              })}
              {(!d?.dealers || d.dealers.length === 0) && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No data yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------- building blocks ---------- */
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
function Empty() { return <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>No data yet</div>; }

const tooltip = { background: "#0f2040", border: "1px solid rgba(201,162,39,.3)", borderRadius: 8, color: "#e8edf8", fontSize: 12 };
const axis = { fontSize: 10, fill: "#94a3b8" };

function BarsChart({ data, x, y, color }: { data: Record<string, unknown>[]; x: string; y: string; color: string }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey={x} tick={axis} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={52} />
          <Tooltip contentStyle={tooltip} formatter={(v) => [idr(Number(v)), "Sales"]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
          <Bar dataKey={y} fill={color} radius={[4, 4, 0, 0]} maxBarSize={46} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HBarChart({ data }: { data: { name: string; sales: number }[] }) {
  if (!data.length) return <Empty />;
  const short = data.map((p) => ({ ...p, label: p.name.length > 26 ? p.name.slice(0, 26) + "…" : p.name }));
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <BarChart layout="vertical" data={short} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" horizontal={false} />
          <XAxis type="number" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "#bcd0ee" }} width={150} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltip} formatter={(v) => [idr(Number(v)), "Sales"]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
          <Bar dataKey="sales" fill="#c9a227" radius={[0, 4, 4, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Donut({ data }: { data: { name: string; value: number }[] }) {
  const filtered = data.filter((x) => x.value > 0);
  if (!filtered.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={filtered} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
            {filtered.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="#0a1628" strokeWidth={2} />)}
          </Pie>
          <Tooltip contentStyle={tooltip} formatter={(v) => idr(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#bcd0ee" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function CostRoas({ data }: { data: { month: string; cost: number; roas: number | null }[] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey="month" tick={axis} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={52} />
          <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={32} />
          <Tooltip contentStyle={tooltip} formatter={(v, n) => n === "roas" ? [(Number(v) || 0).toFixed(2) + "×", "ROAS"] : [idr(Number(v)), "Cost"]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
          <Bar yAxisId="l" dataKey="cost" fill="#1e4a7a" radius={[4, 4, 0, 0]} maxBarSize={40} />
          <Line yAxisId="r" type="monotone" dataKey="roas" stroke="#c9a227" strokeWidth={2.5} dot={{ r: 3, fill: "#c9a227" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrafficTrend({ data }: { data: { month: string; traffic: number; in_cart: number }[] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey="month" tick={axis} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => num(Number(v))} axisLine={false} tickLine={false} width={48} />
          <Tooltip contentStyle={tooltip} formatter={(v, n) => [num(Number(v)), n === "in_cart" ? "In-Cart" : "Traffic"]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="traffic" stroke="#94a3b8" strokeWidth={2.5} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="in_cart" stroke="#c9a227" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
