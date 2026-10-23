"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Loader from "@/components/Loader";
import SortableHeader from "@/components/SortableHeader";
import { useTableSort } from "@/hooks/useTableSort";
import { fmtDate } from "@/lib/dates";
import DateRangePicker from "@/components/DateRangePicker";
import MultiSelect from "@/components/MultiSelect";
import { NoVendors, VendorBar, num, rp, useVendors, type Supabase } from "./shared";

// Return / Lost product: the goods that did not stay sold, for the check with the fulfillment center.
//   Goods back     a return with goods (Barang dan Dana) that Shopee / Earning refunded: the parcel comes back
//   Lost           refund only: the buyer KEPT the goods, so the goods AND the money are lost
//   Failed         failed delivery: the parcel comes back to the seller
//   Returned qty   Shopee already shows a returned quantity on the completed order
//   Pending        a return still in process or not yet in Earning
// "Vendor paid" tells whether the vendor was already paid for that product in that order (then the vendor owes the goods / credit).
type Row = {
  type: "goods_back" | "lost" | "failed" | "completed" | "pending"; event_at: string | null; store_name: string; order_no: string; ref_no: string | null;
  product_id: string | null; product_name: string | null; variant_id: string | null; variant_name: string | null; qty: number | null;
  status: string | null; reason: string | null; refund: number | null; earn_sales: number | null; earn_refund: number | null;
  goods_status: string | null; return_type: string | null; solution: string | null; harga_beli: number | null; vendor_paid: string | null;
  name_key: string; var_key: string; case_status: Case | null; case_note: string | null; case_by: string | null; case_at: string | null;
};
type Case = "settle" | "nego" | "problem";
// the follow-up with the fulfillment center, kept per product line: Settle = solved, Nego = being negotiated, Problem = needs attention
const CASES: { v: Case; label: string; color: string }[] = [
  { v: "settle", label: "Settle", color: "#86efac" }, { v: "nego", label: "Nego", color: "#60a5fa" }, { v: "problem", label: "Problem", color: "#f87171" },
];
const TYPE: Record<Row["type"], { label: string; color: string }> = {
  goods_back: { label: "Goods back", color: "#c9a227" }, lost: { label: "Lost (buyer kept goods)", color: "#f87171" },
  failed: { label: "Failed delivery", color: "#fb923c" }, completed: { label: "Returned qty (Order Completed)", color: "#60a5fa" },
  pending: { label: "Pending", color: "#fbbf24" },
};
const PAGE = 300;
const cost = (r: Row) => (r.qty || 0) * (r.harga_beli || 0);

export default function ReturnsPanel({ supabase, clientId }: { supabase: Supabase; clientId: string }) {
  const v = useVendors(supabase, clientId);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [stores, setStores] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [caseF, setCaseF] = useState<"" | "open" | Case>("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const load = useCallback(async () => {
    if (!clientId || !v.vendorId) { setRows(null); return; }
    setRows(null); setErr("");
    const { data, error } = await supabase.rpc("payout_returns", { p_client_id: clientId, p_vendor: v.vendorId, p_from: from || null, p_to: to || null });
    if (error) setErr(error.message);
    setRows(error ? [] : ((data as Row[]) || [])); setLimit(PAGE);
  }, [supabase, clientId, v.vendorId, from, to]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const typeOpts = Object.entries(TYPE).map(([k, x]) => ({ value: k, label: x.label }));
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => (!stores.length || stores.includes(r.store_name))).filter((r) => !types.length || types.includes(r.type))
      .filter((r) => !caseF || (caseF === "open" ? !r.case_status : r.case_status === caseF))
      .filter((r) => !q || r.order_no.toLowerCase().includes(q) || (r.ref_no || "").toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q)
        || (r.product_id || "").toLowerCase().includes(q) || (r.variant_name || "").toLowerCase().includes(q));
  }, [rows, search, stores, types, caseF]);
  const { sortedData, sortConfig, requestSort } = useTableSort<Row>(filtered);
  const H = (label: string, key: keyof Row, numCol = false) =>
    <SortableHeader label={label} sortKey={key} currentSort={sortConfig} onRequestSort={requestSort} className={numCol ? "num" : undefined} />;

  const sum = (t: Row["type"]) => filtered.filter((r) => r.type === t).reduce((a, r) => ({ qty: a.qty + (r.qty || 0), cost: a.cost + cost(r) }), { qty: 0, cost: 0 });

  async function setCase(r: Row, next: Case | null) {
    let note: string | null = r.case_note;
    if (next === "nego" || next === "problem") {
      const n = window.prompt(next === "nego" ? "Nego — note (what was agreed / asked)? Leave empty for none." : "Problem — what is the problem?", r.case_note || "");
      if (n === null) return;
      note = n;
    } else note = null;
    const { error } = await supabase.rpc("return_case_set", {
      p_client_id: clientId, p_store: r.store_name, p_order_no: r.order_no, p_name_key: r.name_key, p_var_key: r.var_key, p_status: next, p_note: note,
    });
    if (error) { setErr(error.message); return; }
    setErr("");
    setRows((all) => (all || []).map((x) => x.store_name === r.store_name && x.order_no === r.order_no && x.name_key === r.name_key && x.var_key === r.var_key
      ? { ...x, case_status: next, case_note: next ? (note || null) : null, case_at: new Date().toISOString() } : x));
  }

  function csv() {
    const head = ["Date", "Type", "Store", "No Pesanan", "No Return", "Product ID", "Product", "Variant ID", "Variant", "Qty", "Goods status", "Refund", "Harga Beli", "Vendor cost", "Vendor paid", "Status", "Reason", "Case", "Case note"];
    const esc = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")].concat(sortedData.map((r) => [r.event_at?.slice(0, 10), TYPE[r.type].label, r.store_name, r.order_no, r.ref_no, r.product_id, r.product_name, r.variant_id, r.variant_name,
      r.qty, r.goods_status, r.refund, r.harga_beli, cost(r), r.vendor_paid, r.status, r.reason, r.case_status || "open", r.case_note].map(esc).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `return-lost-${v.vendor?.name || "vendor"}.csv`.replace(/[^\w.-]+/g, "_");
    a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="panel">
      <h3>Return / Lost product</h3>
      <div className="hint">Goods that did not stay sold — to check with the fulfillment center · Goods back and Failed delivery come back to you · Lost = the buyer kept the goods and got the money back</div>
      <VendorBar v={v} showStores={false}>
        <div className="fld"><label>Stores</label>
          <MultiSelect options={v.vendor?.stores || []} value={stores} onChange={setStores} allLabel="All stores" unit="stores" />
        </div>
        <div className="fld"><label>Type</label>
          <MultiSelect options={typeOpts.map((o) => o.value)} labels={Object.fromEntries(typeOpts.map((o) => [o.value, o.label]))} value={types} onChange={setTypes} allLabel="All types" unit="types" />
        </div>
        <div className="fld"><label>Return date</label>
          <DateRangePicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        </div>
        <div className="fld"><label>Case</label>
          <select value={caseF} onChange={(e) => setCaseF(e.target.value as "" | "open" | Case)}>
            <option value="">All ({(rows || []).length})</option>
            <option value="open">Open — no case yet ({(rows || []).filter((r) => !r.case_status).length})</option>
            {CASES.map((c) => <option key={c.v} value={c.v}>{c.label} ({(rows || []).filter((r) => r.case_status === c.v).length})</option>)}
          </select>
        </div>
        <div className="fld" style={{ minWidth: 220, flex: 1 }}><label>Search</label><input type="text" placeholder="No Pesanan / No Return / Product ID / Product / Variant" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <button className="btn-ghost" onClick={csv} disabled={!sortedData.length}>⬇ CSV</button>
      </VendorBar>
      {v.vendors && v.vendors.length === 0 && <NoVendors />}
      {err && <div style={{ color: "#f87171", marginBottom: 10, fontSize: 13 }}>✗ {err}</div>}
      {!v.vendorId ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: 30 }}>Pick a vendor to see its returned and lost products.</div>
      ) : rows === null ? <Loader center /> : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            {(Object.keys(TYPE) as Row["type"][]).map((t) => {
              const s = sum(t);
              return (
                <div key={t} style={{ flex: "1 1 170px", padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "rgba(10,22,40,.5)" }}>
                  <div style={{ fontSize: 11, color: TYPE[t].color, fontWeight: 700 }}>{TYPE[t].label}</div>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{num(s.qty)} <span style={{ fontSize: 11.5, fontWeight: 400, color: "var(--muted)" }}>pcs · {rp(s.cost)}</span></div>
                </div>
              );
            })}
          </div>
          <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
            <table className="tbl day-tbl">
              <thead><tr>
                <th>Case</th>{H("Date", "event_at")}{H("Type", "type")}{H("Store name", "store_name")}{H("No Pesanan", "order_no")}{H("No Return", "ref_no")}{H("Product ID", "product_id")}{H("Product", "product_name")}
                {H("Variant", "variant_name")}{H("Qty", "qty", true)}{H("Goods status", "goods_status")}{H("Refund", "refund", true)}{H("Harga Beli", "harga_beli", true)}<th className="num">Vendor cost</th>{H("Vendor paid", "vendor_paid")}{H("Status", "status")}{H("Reason", "reason")}
              </tr></thead>
              <tbody>
                {sortedData.slice(0, limit).map((r, i) => (
                  <tr key={i} style={r.case_status === "settle" ? { opacity: 0.6 } : undefined}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {CASES.map((c) => {
                          const on = r.case_status === c.v;
                          return (
                            <button key={c.v} onClick={() => setCase(r, on ? null : c.v)}
                              title={on ? `${c.label}${r.case_by ? " · " + r.case_by : ""} — click to clear${r.case_note ? "\n" + r.case_note : ""}` : `Mark as ${c.label}`}
                              style={{ padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer",
                                border: `1px solid ${on ? c.color : "rgba(255,255,255,.14)"}`, background: on ? c.color : "transparent", color: on ? "#0a1628" : "var(--muted)" }}>
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                      {r.case_note && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, maxWidth: 190, whiteSpace: "normal" }}>{r.case_note}</div>}
                    </td>
                    <td>{fmtDate(r.event_at)}</td>
                    <td style={{ whiteSpace: "nowrap" }}><b style={{ color: TYPE[r.type].color }}>{TYPE[r.type].label}</b></td>
                    <td>{r.store_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.order_no}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.ref_no || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.product_id || "—"}</td>
                    <td style={{ minWidth: 200, maxWidth: 300, whiteSpace: "normal", overflowWrap: "anywhere" }}>{r.product_name}</td>
                    <td>{r.variant_name && r.variant_name !== "-" ? r.variant_name : "—"}</td>
                    <td className="num"><b>{num(r.qty)}</b></td>
                    <td style={{ minWidth: 150, whiteSpace: "normal" }}>{r.goods_status || "—"}</td>
                    <td className="num">{r.refund ? rp(r.refund) : "—"}</td>
                    <td className="num">{r.harga_beli == null ? <span style={{ color: "#fbbf24" }}>no price</span> : rp(r.harga_beli)}</td>
                    <td className="num">{r.harga_beli == null ? "—" : rp(cost(r))}</td>
                    <td>{r.vendor_paid ? <span style={{ color: "#f87171", fontWeight: 700 }}>Paid · {r.vendor_paid}</span> : <span style={{ color: "var(--muted)" }}>not paid</span>}</td>
                    <td style={{ minWidth: 160, maxWidth: 240, whiteSpace: "normal" }}>{r.status || "—"}</td>
                    <td style={{ minWidth: 180, maxWidth: 280, whiteSpace: "normal", overflowWrap: "anywhere" }}>{r.reason || "—"}</td>
                  </tr>
                ))}
                {sortedData.length === 0 && <tr><td colSpan={17} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No returned or lost products for this vendor.</td></tr>}
              </tbody>
            </table>
            {sortedData.length > limit && (
              <div style={{ textAlign: "center", padding: 12 }}>
                <button className="btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, sortedData.length - limit)} more ({sortedData.length - limit} left)</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
