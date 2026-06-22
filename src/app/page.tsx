"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

type Summary = {
  kpis: { sales: number; orders: number; units: number; visitors: number; ad_cost: number; gmv: number };
  by_brand: { brand: string; sales: number }[];
  by_store: { store_name: string; sales: number }[];
  by_month: { month: string; sales: number }[];
  by_city: { city: string; sales: number }[];
};
type Filters = { years: number[]; months: string[]; cities: string[]; stores: string[] };

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(n || 0);

const KPI_CONFIG = [
  { key: "sales",    label: "Total Sales",     prefix: "Rp ", icon: "💰", source: "spos", color: "#c9a227" },
  { key: "gmv",      label: "GMV",             prefix: "Rp ", icon: "📈", source: "perf", color: "#e8c84a" },
  { key: "ad_cost",  label: "Ad Spend",        prefix: "Rp ", icon: "📢", source: "ads",  color: "#94a3b8" },
  { key: "orders",   label: "Orders",          prefix: "",    icon: "🛒", source: "spos", color: "#c9a227" },
  { key: "units",    label: "Units Sold",      prefix: "",    icon: "📦", source: "spos", color: "#e8c84a" },
  { key: "visitors", label: "Visitors",        prefix: "",    icon: "👁", source: "spos", color: "#94a3b8" },
] as const;

export default function DashboardPage() {
  const [supabase, setSupabase] = useState<ReturnType<typeof createClient>>();
  useEffect(() => { setSupabase(createClient()); }, []);

  const [role, setRole] = useState<string>();
  const [storeLabel, setStoreLabel] = useState("Store");
  const [filters, setFilters] = useState<Filters>({ years: [], months: [], cities: [], stores: [] });
  const [sel, setSel] = useState({ year: "", month: "", city: "", store: "" });
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("role, client_id").eq("id", user.id).single();
      setRole(p?.role);
      if (p?.client_id) {
        const { data: c } = await supabase.from("clients").select("store_label").eq("id", p.client_id).single();
        if (c?.store_label) setStoreLabel(c.store_label);
      }
      const { data: f } = await supabase.rpc("dashboard_filters");
      if (f) setFilters(f as Filters);
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data: d } = await supabase.rpc("dashboard_summary", {
      p_year:  sel.year  ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_city:  sel.city  || null,
      p_store: sel.store || null,
    });
    setData(d as Summary);
    setLoading(false);
  }, [supabase, sel]);

  useEffect(() => { load(); }, [load]);

  const k = data?.kpis;

  const selectStyle = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#e8edf8",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 13,
    outline: "none",
    cursor: "pointer",
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #0a1628 0%, #0d1e3a 60%, #0f2040 100%)" }}>
      <Nav role={role} />

      <main className="mx-auto max-w-7xl space-y-6 p-6">

        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "#e8edf8" }}>Sales Overview</h2>
            <p className="text-xs mt-0.5" style={{ color: "#7b8db0" }}>Shopee performance across all stores</p>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-xs" style={{ color: "#c9a227" }}>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
              Updating…
            </div>
          )}
        </div>

        {/* Filters */}
        <div style={{
          background: "rgba(15,32,64,0.6)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: "12px 16px",
          display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
        }}>
          <span className="text-xs font-medium uppercase tracking-widest" style={{ color: "#7b8db0" }}>Filter</span>
          <select style={selectStyle} value={sel.year} onChange={(e) => setSel({ ...sel, year: e.target.value })}>
            <option value="">All Years</option>
            {filters.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select style={selectStyle} value={sel.month} onChange={(e) => setSel({ ...sel, month: e.target.value })}>
            <option value="">All Months</option>
            {filters.months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select style={selectStyle} value={sel.city} onChange={(e) => setSel({ ...sel, city: e.target.value })}>
            <option value="">All Cities</option>
            {filters.cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select style={selectStyle} value={sel.store} onChange={(e) => setSel({ ...sel, store: e.target.value })}>
            <option value="">All {storeLabel}s</option>
            {filters.stores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {KPI_CONFIG.map((cfg) => {
            const val = k ? k[cfg.key] : null;
            const isGold = cfg.color === "#c9a227";
            return (
              <div key={cfg.key} style={{
                background: "rgba(15,32,64,0.7)",
                border: isGold ? "1px solid rgba(201,162,39,0.2)" : "1px solid rgba(255,255,255,0.06)",
                borderRadius: 14,
                padding: "16px",
                position: "relative",
                overflow: "hidden",
              }}>
                {/* Top accent line */}
                {isGold && (
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: 2,
                    background: "linear-gradient(90deg, transparent, #c9a227, transparent)",
                  }} />
                )}
                <div className="text-lg mb-1">{cfg.icon}</div>
                <div style={{ fontSize: 11, color: "#7b8db0", marginBottom: 6, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {cfg.label}
                </div>
                <div style={{
                  fontSize: val === null ? 20 : 18,
                  fontWeight: 700,
                  color: val === null ? "#2a3a56" : cfg.color,
                  lineHeight: 1.2,
                }}>
                  {val === null ? "–" : cfg.prefix + (cfg.prefix === "Rp " ? idr(val) : num(val))}
                </div>
                <div style={{ fontSize: 10, color: "#4a5d7a", marginTop: 4 }}>{cfg.source.toUpperCase()}</div>
              </div>
            );
          })}
        </div>

        {/* Charts grid */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Chart title="Sales by Brand"          data={data?.by_brand} xKey="brand"      color="#c9a227" />
          <Chart title={`Sales by ${storeLabel}`} data={data?.by_store} xKey="store_name" color="#e8c84a" />
          <Chart title="Sales by Month"          data={data?.by_month} xKey="month"      color="#c9a227" />
          <Chart title="Sales by City"           data={data?.by_city}  xKey="city"       color="#94a3b8" />
        </div>
      </main>
    </div>
  );
}

function Chart({
  title, data, xKey, color,
}: { title: string; data?: Record<string, unknown>[]; xKey: string; color: string }) {
  const empty = !data || data.length === 0;
  return (
    <div style={{
      background: "rgba(15,32,64,0.7)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 14,
      padding: "20px",
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#e8edf8", marginBottom: 16 }}>{title}</div>
      {empty ? (
        <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "#2a3a56", fontSize: 13 }}>
          No data yet
        </div>
      ) : (
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey={xKey}
                tick={{ fontSize: 10, fill: "#7b8db0" }}
                interval={0} angle={-30} textAnchor="end" height={50}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#7b8db0" }}
                tickFormatter={(v) => idr(Number(v))}
                axisLine={false} tickLine={false} width={48}
              />
              <Tooltip
                contentStyle={{
                  background: "#0f2040",
                  border: "1px solid rgba(201,162,39,0.2)",
                  borderRadius: 8,
                  color: "#e8edf8",
                  fontSize: 12,
                }}
                formatter={(v) => ["Rp " + num(Number(v)), "Sales"]}
                cursor={{ fill: "rgba(201,162,39,0.05)" }}
              />
              <Bar dataKey="sales" fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
