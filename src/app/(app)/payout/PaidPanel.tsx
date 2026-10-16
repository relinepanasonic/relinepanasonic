"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Loader from "@/components/Loader";
import SortableHeader from "@/components/SortableHeader";
import { useTableSort } from "@/hooks/useTableSort";
import { fmtDate } from "@/lib/dates";
import { NoVendors, VendorBar, num, rp, useVendors, type Supabase } from "./shared";

// Paid: the order lines already paid to a vendor, newest payout first. Press a Payout No to open it in Detail Payout.
type Paid = {
  payout_no: string; paid_at: string; batch_id: string; completed_at: string; store_name: string; order_no: string;
  product_id: string | null; product_name: string | null; variant_id: string | null; variant_name: string | null;
  qty: number; harga_beli: number; total: number;
};
const PAGE = 300;

export default function PaidPanel({ supabase, clientId, onOpen }: {
  supabase: Supabase; clientId: string; onOpen: (batchId: string) => void;
}) {
  const v = useVendors(supabase, clientId);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Paid[] | null>(null);
  const [err, setErr] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const load = useCallback(async () => {
    if (!clientId) return;
    setRows(null);
    const { data, error } = await supabase.rpc("payout_paid_lines", { p_client_id: clientId, p_vendor: v.vendorId || null, p_from: from || null, p_to: to || null });
    if (error) setErr(error.message);
    setRows(error ? [] : ((data as Paid[]) || [])); setLimit(PAGE);
  }, [supabase, clientId, v.vendorId, from, to]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => !q || r.order_no.toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q)
      || (r.product_id || "").toLowerCase().includes(q) || r.payout_no.toLowerCase().includes(q) || r.store_name.toLowerCase().includes(q));
  }, [rows, search]);
  const { sortedData, sortConfig, requestSort } = useTableSort<Paid>(filtered);
  const H = (label: string, key: keyof Paid, numCol = false) =>
    <SortableHeader label={label} sortKey={key} currentSort={sortConfig} onRequestSort={requestSort} className={numCol ? "num" : undefined} />;
  const total = filtered.reduce((a, r) => a + Number(r.total), 0);

  return (
    <div className="panel">
      <h3>Paid</h3>
      <div className="hint">Order lines already paid to the vendor · press a Payout No to open it</div>
      <VendorBar v={v}>
        <div className="fld" style={{ minWidth: 150 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ colorScheme: "dark" }} /></div>
        <div className="fld" style={{ minWidth: 150 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ colorScheme: "dark" }} /></div>
        <div className="fld" style={{ minWidth: 220, flex: 1 }}><label>Search</label><input type="text" placeholder="Payout No / Store / Order No. / Product" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </VendorBar>
      {v.vendors && v.vendors.length === 0 && <NoVendors />}
      {err && <div style={{ color: "#f87171", marginBottom: 10, fontSize: 13 }}>✗ {err}</div>}
      {rows === null ? <Loader center /> : (
        <>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>{filtered.length.toLocaleString("id-ID")} paid lines · <b style={{ color: "var(--gold)" }}>{rp(total)}</b>{!v.vendorId && " · all vendors"}</div>
          <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
            <table className="tbl day-tbl">
              <thead><tr>
                {H("Paid on", "paid_at")}{H("Payout No", "payout_no")}{H("Completed", "completed_at")}{H("Store name", "store_name")}{H("No Pesanan", "order_no")}
                {H("Product ID", "product_id")}{H("Product", "product_name")}{H("Variant", "variant_name")}{H("Qty", "qty", true)}{H("Harga Beli", "harga_beli", true)}{H("Total", "total", true)}
              </tr></thead>
              <tbody>
                {sortedData.slice(0, limit).map((r, i) => (
                  <tr key={i}>
                    <td>{fmtDate(r.paid_at)}</td>
                    <td><button onClick={() => onOpen(r.batch_id)} style={{ background: "none", border: "none", color: "var(--gold)", fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0 }}>{r.payout_no}</button></td>
                    <td>{fmtDate(r.completed_at)}</td>
                    <td>{r.store_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.order_no}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.product_id || "—"}</td>
                    <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }} title={r.product_name || ""}>{r.product_name}</td>
                    <td>{r.variant_name && r.variant_name !== "-" ? r.variant_name : "—"}</td>
                    <td className="num">{num(r.qty)}</td><td className="num">{rp(r.harga_beli)}</td><td className="num">{rp(r.total)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Nothing paid yet.</td></tr>}
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
