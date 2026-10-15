"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import SortableHeader from "@/components/SortableHeader";
import { useTableSort } from "@/hooks/useTableSort";
import { fmtDate } from "@/lib/dates";

// Pajak sub page of Finance Detail: the tax (PPh 22) Shopee withholds, per
// transaction and per SKU (product), with a drawer for each:
//   transaction row -> its SKUs     |     SKU row -> its transactions

const MONTH_ORDER = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];
const GOLD = "#c9a227";
const PAGE = 500;

const rpFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const rpC = (n: number) => {
  const v = n || 0, a = Math.abs(v);
  if (a >= 1e9) return "Rp " + (v / 1e9).toFixed(1) + "M";
  if (a >= 1e6) return "Rp " + (v / 1e6).toFixed(1) + "jt";
  if (a >= 1e3) return "Rp " + Math.round(v / 1e3) + "rb";
  return "Rp " + Math.round(v);
};
const pctStr = (tax: number, base: number) => (base > 0 ? ((Math.abs(tax) / base) * 100).toFixed(2) + "%" : "—");

type Summary = {
  kpis: { tax: number; tax_base: number; sales: number; orders: number; taxed_orders: number; rate: number | null };
  products: number;
  monthly: { month: string; tax: number; tax_base: number }[];
  daily: { day: string; tax: number; orders: number }[];
  by_product: { kode_produk: string; nama_produk: string | null; orders: number; sales: number; tax_base: number; tax: number }[];
};
type OrderRow = { order_no: string; release_date: string | null; buyer_username: string | null; payment_method: string | null; sales: number | null; tax: number | null; tax_base: number | null };
type ItemRow = { order_no: string; kode_produk: string | null; nama_produk: string | null; release_date: string | null; sales: number | null; tax: number | null; tax_base: number | null; net_income: number | null };
type Filters = { years: number[]; months: string[]; stores?: { store_name: string; city: string | null }[] };
type Sel = { year: string; month: string; week: string; city: string; store: string };
type Drawer = { type: "order"; id: string } | { type: "product"; id: string; name: string | null } | null;

export default function PajakPanel({ clientId }: { clientId: string }) {
  const [supabase] = useState(() => createClient());
  const [filters, setFilters] = useState<Filters>({ years: [], months: [], stores: [] });
  const [sel, setSel] = useState<Sel>({ year: "", month: "", week: "", city: "", store: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"orders" | "products">("orders");
  const [drawer, setDrawer] = useState<Drawer>(null);

  // dealers this user may see (role-scoped by the RPC) + the main dashboard's list,
  // so the page opens even before anything is uploaded
  useEffect(() => {
    (async () => {
      const { data: f } = await supabase.rpc("finance_filters");
      const { data: df } = await supabase.rpc("dashboard_filters");
      const known = new Set(((f as Filters | null)?.stores || []).map((x) => x.store_name));
      const extra = (((df as { dealers?: { value: string; city: string | null }[] } | null)?.dealers) || [])
        .filter((x) => !known.has(x.value)).map((x) => ({ store_name: x.value, city: x.city }));
      const base = (f as Filters | null) || { years: [], months: [] };
      setFilters({ ...base, stores: [...(base.stores || []), ...extra] });
    })();
  }, [supabase]);

  const years = useMemo(() => [...filters.years].sort((a, b) => b - a), [filters.years]);
  const months = useMemo(() => [...filters.months].sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b)), [filters.months]);
  const cities = useMemo(() => Array.from(new Set((filters.stores || []).map((x) => x.city).filter(Boolean) as string[])).sort(), [filters.stores]);
  const storesForCity = useMemo(() => Array.from(new Set((filters.stores || [])
    .filter((x) => !sel.city || x.city === sel.city).map((x) => x.store_name))).sort(), [filters.stores, sel.city]);

  useEffect(() => {
    // a dealer owner (or a one-dealer city) has exactly one option: pick it
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!sel.store && storesForCity.length === 1) setSel((s) => ({ ...s, store: storesForCity[0] }));
  }, [storesForCity, sel.store]);

  const load = useCallback(async () => {
    if (!clientId || !sel.store) { setD(null); return; }
    setLoading(true);
    const { data } = await supabase.rpc("pajak_summary", {
      p_year: sel.year ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_week: sel.week || null,
      p_city: sel.city || null,
      p_store: sel.store,
    });
    setD(data as Summary);
    setLoading(false);
  }, [supabase, clientId, sel]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const k = d?.kpis;
  const chart = useMemo(() => {
    if (!d) return [];
    if (sel.month) return d.daily.map((x) => ({ label: x.day.slice(8), tax: x.tax }));
    return [...d.monthly].sort((a, b) => MONTH_ORDER.indexOf(a.month) - MONTH_ORDER.indexOf(b.month)).map((x) => ({ label: x.month.slice(0, 3), tax: x.tax }));
  }, [d, sel.month]);

  return (
    <div className="fin-compact">
      <div className="filterbar">
        <SelBox label="City" value={sel.city} onChange={(v) => setSel((s) => ({ ...s, city: v, store: "" }))} opts={cities} all="All Cities" />
        <SelBox label="Dealer" value={sel.store} onChange={(v) => setSel((s) => ({ ...s, store: v }))} opts={storesForCity} all="Pick a dealer…" />
        {sel.store && (
          <>
            <SelBox label="Year" value={sel.year} onChange={(v) => setSel((s) => ({ ...s, year: v }))} opts={years.map(String)} all="All Years" />
            <SelBox label="Month" value={sel.month} onChange={(v) => setSel((s) => ({ ...s, month: v }))} opts={months} all="All Months" />
            <SelBox label="Week" value={sel.week} onChange={(v) => setSel((s) => ({ ...s, week: v }))} opts={WEEKS} all="All Weeks" />
          </>
        )}
        <button className="btn-ghost" onClick={() => setSel({ year: "", month: "", week: "", city: "", store: "" })}>Reset</button>
        {loading && <Loader />}
      </div>

      {!sel.store ? (
        <div className="panel">
          <div className="coming">
            <div className="big">🧾</div>
            <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>Choose a dealer</h3>
            <p style={{ maxWidth: 420, margin: 0 }}>Pajak is shown per dealer — pick a dealer above to see its tax per transaction and per SKU.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="kpi-grid kpi-grid-5">
            <div className="kpi kpi-cost"><div className="kpi-icon">🧾</div><div className="lbl">Total Pajak</div><div className="val">{k ? rpC(k.tax) : "—"}</div></div>
            <div className="kpi"><div className="kpi-icon">📐</div><div className="lbl">Tax Base (DPP)</div><div className="val">{k ? rpC(k.tax_base) : "—"}</div></div>
            <div className="kpi"><div className="kpi-icon">％</div><div className="lbl">Effective Rate</div><div className="val">{k?.rate != null ? (k.rate * 100).toFixed(2) + "%" : "—"}</div></div>
            <div className="kpi"><div className="kpi-icon">🧮</div><div className="lbl">Taxed Transactions</div><div className="val">{k ? `${k.taxed_orders.toLocaleString("id-ID")} / ${k.orders.toLocaleString("id-ID")}` : "—"}</div></div>
            <div className="kpi"><div className="kpi-icon">📦</div><div className="lbl">SKUs with Pajak</div><div className="val">{d ? d.products.toLocaleString("id-ID") : "—"}</div></div>
          </div>

          <div className="panel">
            <h3>{sel.month ? "Pajak per day" : "Pajak per month"}</h3>
            <div className="hint">Withheld income tax (PPh 22), by fund release date</div>
            {chart.length === 0 ? <EmptyBox /> : (
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={chart} margin={{ left: 4, right: 12, top: 10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={(v) => rpC(Number(v))} width={64} />
                    <Tooltip contentStyle={{ background: "#0f2040", border: "1px solid rgba(201,162,39,.3)", borderRadius: 8, color: "#e8edf8", fontSize: 12 }} itemStyle={{ color: "#94a3b8" }} formatter={(v) => [rpFull(Number(v)), "Pajak"]} cursor={{ fill: "rgba(201,162,39,.06)" }} />
                    <Bar dataKey="tax" fill={GOLD} radius={[5, 5, 2, 2]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, margin: "4px 0 10px", flexWrap: "wrap" }}>
            <button onClick={() => setView("orders")} style={tabBtn(view === "orders")}>Per Transaction</button>
            <button onClick={() => setView("products")} style={tabBtn(view === "products")}>Per SKU</button>
          </div>

          {view === "orders"
            ? <OrdersTable supabase={supabase} clientId={clientId} sel={sel} onOpen={(id) => setDrawer({ type: "order", id })} />
            : <ProductsTable rows={d?.by_product ?? []} loading={loading} onOpen={(p) => setDrawer({ type: "product", id: p.kode_produk, name: p.nama_produk })} />}
        </>
      )}

      {drawer && (
        <DetailDrawer supabase={supabase} clientId={clientId} sel={sel} drawer={drawer}
          onOpenOrder={(id) => setDrawer({ type: "order", id })} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}

/* ── Per Transaction ─────────────────────────────────────────────── */
function OrdersTable({ supabase, clientId, sel, onOpen }: {
  supabase: ReturnType<typeof createClient>; clientId: string; sel: Sel; onOpen: (orderNo: string) => void;
}) {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [onlyTaxed, setOnlyTaxed] = useState(true);
  const [more, setMore] = useState(false);

  const fetchPage = useCallback(async (from: number) => {
    let q = supabase.from("finance_rows")
      .select("order_no,release_date,buyer_username,payment_method,sales,tax,tax_base", { count: "exact" })
      .eq("client_id", clientId).eq("store_name", sel.store);
    if (sel.year) q = q.eq("year", Number(sel.year));
    if (sel.month) q = q.eq("month", sel.month);
    if (sel.week) q = q.eq("week", sel.week);
    if (sel.city) q = q.eq("dealer_city", sel.city);
    if (onlyTaxed) q = q.neq("tax", 0);
    if (search.trim()) q = q.ilike("order_no", `%${search.trim()}%`);
    const { data, count } = await q.order("release_date", { ascending: false }).order("order_no").range(from, from + PAGE - 1);
    return { data: (data as OrderRow[]) || [], count: count ?? 0 };
  }, [supabase, clientId, sel, onlyTaxed, search]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await fetchPage(0);
      if (cancelled) return;
      setRows(r.data); setTotal(r.count);
    }, search ? 350 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [fetchPage, search]);

  async function loadMore() {
    if (!rows) return;
    setMore(true);
    const r = await fetchPage(rows.length);
    setRows([...rows, ...r.data]);
    setMore(false);
  }

  const { sortedData, sortConfig, requestSort } = useTableSort<OrderRow>(rows ?? []);

  return (
    <div className="panel">
      <h3>Pajak per Transaction</h3>
      <div className="hint">Click a transaction to see its SKUs · date = fund release date</div>
      <div className="filterbar" style={{ marginTop: 4, marginBottom: 10 }}>
        <div className="fld" style={{ minWidth: 240 }}>
          <label>Search</label>
          <input type="text" placeholder="Order No." value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e8edf8", cursor: "pointer", alignSelf: "flex-end", paddingBottom: 8 }}>
          <input type="checkbox" checked={onlyTaxed} onChange={(e) => setOnlyTaxed(e.target.checked)} /> Only transactions with Pajak
        </label>
      </div>
      {rows === null ? <Loader center /> : (
        <>
          <div className="tbl-wrap" style={{ maxHeight: 460 }}>
            <table className="tbl">
              <thead><tr>
                <SortableHeader label="Date" sortKey="release_date" currentSort={sortConfig} onRequestSort={requestSort} />
                <SortableHeader label="Order No." sortKey="order_no" currentSort={sortConfig} onRequestSort={requestSort} />
                <SortableHeader label="Buyer" sortKey="buyer_username" currentSort={sortConfig} onRequestSort={requestSort} />
                <SortableHeader label="Sales" sortKey="sales" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                <SortableHeader label="Tax Base" sortKey="tax_base" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                <SortableHeader label="Pajak" sortKey="tax" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                <th className="num">Rate</th>
              </tr></thead>
              <tbody>
                {sortedData.map((r) => (
                  <tr key={r.order_no} onClick={() => onOpen(r.order_no)} style={{ cursor: "pointer" }}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.release_date)}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.order_no}</td>
                    <td>{r.buyer_username || "—"}</td>
                    <td className="num">{rpFull(r.sales || 0)}</td>
                    <td className="num">{rpFull(r.tax_base || 0)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{rpFull(Math.abs(r.tax || 0))}</td>
                    <td className="num">{pctStr(r.tax || 0, r.tax_base || 0)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No transactions with Pajak for these filters. Pajak comes from Shopee&apos;s new Income layout.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span>Showing {rows.length.toLocaleString("id-ID")} of {total.toLocaleString("id-ID")} transactions</span>
            {rows.length < total && <button className="btn-ghost" disabled={more} onClick={loadMore}>{more ? "Loading…" : `Load ${Math.min(PAGE, total - rows.length)} more`}</button>}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Per SKU ─────────────────────────────────────────────────────── */
function ProductsTable({ rows, loading, onOpen }: {
  rows: Summary["by_product"]; loading: boolean; onOpen: (p: Summary["by_product"][number]) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.kode_produk.toLowerCase().includes(q) || (r.nama_produk || "").toLowerCase().includes(q)) : rows;
  }, [rows, search]);
  const { sortedData, sortConfig, requestSort } = useTableSort<Summary["by_product"][number]>(filtered, "tax");

  return (
    <div className="panel">
      <h3>Pajak per SKU</h3>
      <div className="hint">Click a SKU to see the transactions it was in · needs the new Income layout (per-product rows)</div>
      <div className="filterbar" style={{ marginTop: 4, marginBottom: 10 }}>
        <div className="fld" style={{ minWidth: 260 }}>
          <label>Search</label>
          <input type="text" placeholder="Product code / name" value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
        </div>
        {loading && <Loader />}
      </div>
      <div className="tbl-wrap" style={{ maxHeight: 460 }}>
        <table className="tbl">
          <thead><tr>
            <SortableHeader label="Product Name" sortKey="nama_produk" currentSort={sortConfig} onRequestSort={requestSort} />
            <SortableHeader label="Product Code" sortKey="kode_produk" currentSort={sortConfig} onRequestSort={requestSort} />
            <SortableHeader label="Transactions" sortKey="orders" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label="Sales" sortKey="sales" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label="Tax Base" sortKey="tax_base" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label="Pajak" sortKey="tax" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <th className="num">Rate</th>
          </tr></thead>
          <tbody>
            {sortedData.map((r) => (
              <tr key={r.kode_produk} onClick={() => onOpen(r)} style={{ cursor: "pointer" }}>
                <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.nama_produk || undefined}>{r.nama_produk || "—"}</td>
                <td style={{ fontFamily: "monospace", fontSize: 12.5, whiteSpace: "nowrap" }}>{r.kode_produk}</td>
                <td className="num">{r.orders.toLocaleString("id-ID")}</td>
                <td className="num">{rpFull(r.sales)}</td>
                <td className="num">{rpFull(r.tax_base)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{rpFull(r.tax)}</td>
                <td className="num">{pctStr(r.tax, r.tax_base)}</td>
              </tr>
            ))}
            {sortedData.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No SKU rows for these filters. Upload Shopee&apos;s new Income layout to get Pajak per SKU.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Sub-sub page: transaction -> SKUs, SKU -> transactions ────────── */
function DetailDrawer({ supabase, clientId, sel, drawer, onOpenOrder, onClose }: {
  supabase: ReturnType<typeof createClient>; clientId: string; sel: Sel; drawer: NonNullable<Drawer>;
  onOpenOrder: (orderNo: string) => void; onClose: () => void;
}) {
  const [rows, setRows] = useState<ItemRow[] | null>(null);

  useEffect(() => {
    (async () => {
      setRows(null);
      let q = supabase.from("finance_items")
        .select("order_no,kode_produk,nama_produk,release_date,sales,tax,tax_base,net_income")
        .eq("client_id", clientId).eq("store_name", sel.store);
      if (drawer.type === "order") q = q.eq("order_no", drawer.id);
      else {
        q = q.eq("kode_produk", drawer.id);
        if (sel.year) q = q.eq("year", Number(sel.year));
        if (sel.month) q = q.eq("month", sel.month);
        if (sel.week) q = q.eq("week", sel.week);
        if (sel.city) q = q.eq("dealer_city", sel.city);
      }
      const { data } = await q.order("release_date", { ascending: false }).order("order_no").limit(2000);
      setRows((data as ItemRow[]) || []);
    })();
  }, [supabase, clientId, sel, drawer]);

  const tot = (rows || []).reduce((a, r) => ({ sales: a.sales + (r.sales || 0), base: a.base + (r.tax_base || 0), tax: a.tax + Math.abs(r.tax || 0) }), { sales: 0, base: 0, tax: 0 });
  const title = drawer.type === "order" ? `Transaction ${drawer.id}` : `SKU ${drawer.name || drawer.id}`;

  return (
    <div style={overlay} onClick={onClose}>
      <div style={drawerBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", wordBreak: "break-word" }}>{title}</div>
            <div className="hint">{drawer.type === "order" ? "Pajak per SKU in this transaction" : `Product code ${drawer.id} · its transactions`}</div>
          </div>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>
        {rows === null ? <Loader center /> : (
          <>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "8px 0 12px", fontSize: 13, color: "#cdd9f0" }}>
              <span>Sales <b style={{ color: "#fff" }}>{rpFull(tot.sales)}</b></span>
              <span>Tax base <b style={{ color: "#fff" }}>{rpFull(tot.base)}</b></span>
              <span>Pajak <b style={{ color: GOLD }}>{rpFull(tot.tax)}</b></span>
              <span>Rate <b style={{ color: "#fff" }}>{pctStr(tot.tax, tot.base)}</b></span>
            </div>
            <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
              <table className="tbl" style={{ color: "#e8edf8" }}>
                <thead><tr>
                  {drawer.type === "order"
                    ? (<><th>Product Name</th><th>Product Code</th></>)
                    : (<><th>Date</th><th>Order No.</th></>)}
                  <th className="num">Sales</th><th className="num">Tax Base</th><th className="num">Pajak</th><th className="num">Rate</th><th className="num">Net Income</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}
                      onClick={drawer.type === "product" ? () => onOpenOrder(r.order_no) : undefined}
                      style={drawer.type === "product" ? { cursor: "pointer" } : undefined}>
                      {drawer.type === "order"
                        ? (<><td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.nama_produk || undefined}>{r.nama_produk || "—"}</td>
                             <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.kode_produk || "—"}</td></>)
                        : (<><td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.release_date)}</td>
                             <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.order_no}</td></>)}
                      <td className="num">{rpFull(r.sales || 0)}</td>
                      <td className="num">{rpFull(r.tax_base || 0)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{rpFull(Math.abs(r.tax || 0))}</td>
                      <td className="num">{pctStr(r.tax || 0, r.tax_base || 0)}</td>
                      <td className="num">{rpFull(r.net_income || 0)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                      No per-SKU rows for this {drawer.type === "order" ? "transaction" : "product"} — they come from Shopee&apos;s new Income layout.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── small building blocks ───────────────────────────────────────── */
function SelBox({ label, value, onChange, opts, all }: { label: string; value: string; onChange: (v: string) => void; opts: string[]; all: string }) {
  return (
    <div className="fld"><label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
function EmptyBox() {
  return <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>No data yet</div>;
}
const inputStyle: React.CSSProperties = { background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" };
const tabBtn = (on: boolean): React.CSSProperties => ({
  padding: "9px 20px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
  border: `1px solid ${on ? "var(--gold)" : "rgba(201,162,39,.2)"}`,
  background: on ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
  color: on ? "var(--navy-deep)" : "#e8edf8",
});
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "clamp(10px,3vw,30px) clamp(6px,2vw,20px)", overflowY: "auto" };
const drawerBox: React.CSSProperties = { width: "min(98vw,1100px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: "clamp(12px,3vw,26px)", boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
