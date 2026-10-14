"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import SortableHeader from "@/components/SortableHeader";
import { useTableSort } from "@/hooks/useTableSort";

// Earning: the Finance "Daily Transaction Detail" per dealer, one row per
// fund-release day, with a check box in the first column. Ticked days become a
// payout with "Proceed Payment" (bottom left). Days that are already in a
// payout show its number and cannot be ticked again.

type Supabase = ReturnType<typeof createClient>;
const MONTH_ORDER = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];
const rpFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

type Row = {
  day: string; orders: number; sales: number; promotion_cost: number; marketplace_fee: number;
  tax: number; refund: number; net_income: number; sku_rows: number; batch_id: string | null; payout_no: string | null;
};
type Filters = { years: number[]; months: string[]; stores?: { store_name: string; city: string | null }[] };
type Sel = { year: string; month: string; week: string; city: string; store: string };

export default function EarningPanel({ supabase, onProceeded, onOpenPayout }: {
  supabase: Supabase; onProceeded: (batchId: string) => void; onOpenPayout: (batchId: string) => void;
}) {
  const [filters, setFilters] = useState<Filters>({ years: [], months: [], stores: [] });
  const [sel, setSel] = useState<Sel>({ year: "", month: "", week: "", city: "", store: "" });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // dealers: those with finance data + the role-scoped dealer list of the dashboard
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
    // a one-dealer city has exactly one option: pick it
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!sel.store && storesForCity.length === 1) setSel((s) => ({ ...s, store: storesForCity[0] }));
  }, [storesForCity, sel.store]);

  const load = useCallback(async () => {
    setPicked(new Set());
    if (!sel.store) { setRows(null); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc("payout_earnings", {
      p_year: sel.year ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_week: sel.week || null,
      p_city: sel.city || null,
      p_store: sel.store,
    });
    if (error) alert(error.message);
    setRows((data as Row[]) || []);
    setLoading(false);
  }, [supabase, sel]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const { sortedData, sortConfig, requestSort } = useTableSort<Row>(rows ?? []);
  const selectable = sortedData.filter((r) => !r.batch_id);
  const allTicked = selectable.length > 0 && selectable.every((r) => picked.has(r.day));
  const chosen = (rows ?? []).filter((r) => picked.has(r.day));
  const chosenNet = chosen.reduce((a, r) => a + (r.net_income || 0), 0);
  const chosenOrders = chosen.reduce((a, r) => a + (r.orders || 0), 0);
  const noSku = chosen.filter((r) => r.sku_rows === 0).length;

  function toggle(day: string) {
    setPicked((s) => { const n = new Set(s); if (n.has(day)) n.delete(day); else n.add(day); return n; });
  }
  function toggleAll() {
    setPicked(allTicked ? new Set() : new Set(selectable.map((r) => r.day)));
  }

  async function proceed() {
    if (chosen.length === 0) return;
    const msg = `Proceed payment for ${sel.store}?\n\n${chosen.length} day(s) · ${chosenOrders.toLocaleString("id-ID")} orders · Net income ${rpFull(chosenNet)}` +
      (noSku ? `\n\n⚠ ${noSku} of these day(s) have no per-SKU data (new Income layout), so they add no SKU lines.` : "");
    if (!confirm(msg)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("payout_create", {
      p_store: sel.store, p_city: sel.city || (filters.stores || []).find((x) => x.store_name === sel.store)?.city || null,
      p_days: chosen.map((r) => r.day).sort(),
    });
    setBusy(false);
    if (error) { alert(error.message); return; }
    onProceeded((data as { id: string }).id);
  }

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
            <div className="big">💸</div>
            <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>Choose a dealer</h3>
            <p style={{ maxWidth: 420, margin: 0 }}>Earnings are shown per dealer — pick a dealer above, tick the days to pay, then press Proceed Payment.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="panel">
            <h3>Earning — Daily Transaction Detail</h3>
            <div className="hint">Tick the days to pay · date = fund release date · days already in a payout are locked</div>
            {rows === null ? <Loader center /> : (
              <div className="tbl-wrap" style={{ maxHeight: 460 }}>
                <table className="tbl">
                  <thead><tr>
                    <th style={{ width: 38 }}>
                      <input type="checkbox" checked={allTicked} onChange={toggleAll} disabled={selectable.length === 0} title="Select all unpaid days" />
                    </th>
                    <SortableHeader label="Date" sortKey="day" currentSort={sortConfig} onRequestSort={requestSort} />
                    <SortableHeader label="Orders" sortKey="orders" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                    <SortableHeader label="Sales" sortKey="sales" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                    <SortableHeader label="Promotional Cost" sortKey="promotion_cost" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                    <SortableHeader label="Market Place Fee" sortKey="marketplace_fee" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                    <SortableHeader label="Pajak" sortKey="tax" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                    <SortableHeader label="Refund" sortKey="refund" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                    <SortableHeader label="Net Income" sortKey="net_income" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                    <th>Payout</th>
                  </tr></thead>
                  <tbody>
                    {sortedData.map((r) => {
                      const locked = !!r.batch_id;
                      return (
                        <tr key={r.day} style={{ opacity: locked ? 0.6 : 1, cursor: locked ? "default" : "pointer" }} onClick={locked ? undefined : () => toggle(r.day)}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={picked.has(r.day)} disabled={locked} onChange={() => toggle(r.day)} />
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.day)}</td>
                          <td className="num">{r.orders.toLocaleString("id-ID")}</td>
                          <td className="num">{rpFull(r.sales)}</td>
                          <td className="num">{rpFull(r.promotion_cost)}</td>
                          <td className="num">{rpFull(r.marketplace_fee)}</td>
                          <td className="num">{rpFull(r.tax)}</td>
                          <td className="num">{rpFull(r.refund)}</td>
                          <td className="num" style={{ fontWeight: 700, color: r.net_income >= 0 ? "#86efac" : "#f87171" }}>{rpFull(r.net_income)}</td>
                          <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                            {locked
                              ? <button className="btn-ghost" style={{ padding: "3px 10px", fontSize: 12 }} onClick={(e) => { e.stopPropagation(); onOpenPayout(r.batch_id!); }}>{r.payout_no || "Payout"}</button>
                              : r.sku_rows === 0 ? <span title="No per-SKU rows for this day (older Income layout)" style={{ color: "#fbbf24" }}>⚠ no SKU data</span> : <span style={{ color: "var(--muted)" }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No earnings for these filters. Upload this dealer&apos;s Income file on the Upload page first.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Proceed bar — bottom left, always in view while the table is long */}
          <div style={{ position: "sticky", bottom: 12, zIndex: 20, display: "flex", justifyContent: "flex-start", marginTop: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: "rgba(7,13,26,.94)", border: "1px solid var(--card-border)", borderRadius: 14, padding: "10px 14px", backdropFilter: "blur(10px)" }}>
              <button className="btn-gold" disabled={chosen.length === 0 || busy} onClick={proceed} style={{ padding: "10px 26px", fontSize: 14.5 }}>
                {busy ? "Processing…" : "Proceed Payment"}
              </button>
              <span style={{ fontSize: 13, color: "#cdd9f0" }}>
                {chosen.length === 0
                  ? "Tick one or more days"
                  : <><b style={{ color: "#fff" }}>{chosen.length}</b> day(s) · {chosenOrders.toLocaleString("id-ID")} orders · Net income <b style={{ color: "var(--gold)" }}>{rpFull(chosenNet)}</b></>}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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
