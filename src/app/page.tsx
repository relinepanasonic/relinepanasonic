"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import Nav from "@/components/Nav";

// Authenticated, per-user dashboard — never static-prerender it.
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

export default function DashboardPage() {
  // Create the client browser-side only (never during SSR/build prerender).
  const [supabase, setSupabase] = useState<ReturnType<typeof createClient>>();
  useEffect(() => { setSupabase(createClient()); }, []);
  const [role, setRole] = useState<string>();
  const [storeLabel, setStoreLabel] = useState("Store");
  const [filters, setFilters] = useState<Filters>({ years: [], months: [], cities: [], stores: [] });
  const [sel, setSel] = useState({ year: "", month: "", city: "", store: "" });
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve profile + client labels once.
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase
        .from("profiles").select("role, client_id").eq("id", user.id).single();
      setRole(p?.role);
      if (p?.client_id) {
        const { data: c } = await supabase
          .from("clients").select("store_label").eq("id", p.client_id).single();
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
      p_year: sel.year ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_city: sel.city || null,
      p_store: sel.store || null,
    });
    setData(d as Summary);
    setLoading(false);
  }, [supabase, sel]);

  useEffect(() => { load(); }, [load]);

  const k = data?.kpis;
  const kpis = [
    { label: "Sales (SPOS)", value: k ? "Rp " + idr(k.sales) : "–" },
    { label: "Orders", value: k ? num(k.orders) : "–" },
    { label: "Units", value: k ? num(k.units) : "–" },
    { label: "Visitors", value: k ? num(k.visitors) : "–" },
    { label: "Ad Cost", value: k ? "Rp " + idr(k.ad_cost) : "–" },
    { label: "GMV (Performa)", value: k ? "Rp " + idr(k.gmv) : "–" },
  ];

  const sb = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav role={role} />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        {/* filters */}
        <div className="flex flex-wrap gap-3">
          <select className={sb} value={sel.year} onChange={(e) => setSel({ ...sel, year: e.target.value })}>
            <option value="">All Years</option>
            {filters.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className={sb} value={sel.month} onChange={(e) => setSel({ ...sel, month: e.target.value })}>
            <option value="">All Months</option>
            {filters.months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className={sb} value={sel.city} onChange={(e) => setSel({ ...sel, city: e.target.value })}>
            <option value="">All Cities</option>
            {filters.cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={sb} value={sel.store} onChange={(e) => setSel({ ...sel, store: e.target.value })}>
            <option value="">All {storeLabel}s</option>
            {filters.stores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {loading && <span className="self-center text-sm text-gray-400">Loading…</span>}
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {kpis.map((c) => (
            <div key={c.label} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="text-xs text-gray-500">{c.label}</div>
              <div className="mt-1 text-lg font-semibold">{c.value}</div>
            </div>
          ))}
        </div>

        {/* charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Chart title="Sales by Brand" data={data?.by_brand} xKey="brand" />
          <Chart title={`Sales by ${storeLabel}`} data={data?.by_store} xKey="store_name" />
          <Chart title="Sales by Month" data={data?.by_month} xKey="month" />
          <Chart title="Sales by City" data={data?.by_city} xKey="city" />
        </div>
      </main>
    </div>
  );
}

function Chart({
  title, data, xKey,
}: { title: string; data?: Record<string, unknown>[]; xKey: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-medium">{title}</div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={data || []} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => idr(Number(v))} />
            <Tooltip formatter={(v) => "Rp " + num(Number(v))} />
            <Bar dataKey="sales" fill="#2563eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
