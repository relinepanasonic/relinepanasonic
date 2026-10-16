"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Loader from "@/components/Loader";
import SortableHeader from "@/components/SortableHeader";
import { useTableSort } from "@/hooks/useTableSort";
import { fmtDate } from "@/lib/dates";
import { NoVendors, VendorBar, downloadPayout, num, rp, useVendors, type Supabase } from "./shared";
import { downloadPayoutPdf } from "@/lib/payoutPdfClient";
import type { PayoutBatch, PayoutLine } from "@/lib/payoutExport";

// Not Paid: completed order lines (Order Completed) of a VENDOR's stores that were not paid yet.
// Tick lines (or "Check All") and press "Pay to Vendor" (top right): the lines are saved as a payout and the XLS + PDF
// (Summary / Detail) are downloaded. A line needs a Product ID and a Harga Beli to be payable.

type Line = {
  completed_at: string; store_name: string; order_no: string; name_key: string; var_key: string; product_id: string | null; product_name: string;
  variant_id: string | null; variant_name: string; qty: number; harga_beli: number | null; total: number; payable: boolean;
  reason: "no_id" | "no_price" | null;
};
const PAGE = 300;
const keyOf = (l: Pick<Line, "store_name" | "order_no" | "name_key" | "var_key">) => `${l.store_name}||${l.order_no}||${l.name_key}||${l.var_key}`;

export default function NotPaidPanel({ supabase, clientId, onPaid, onGoPrice }: {
  supabase: Supabase; clientId: string; onPaid: (batchId: string) => void; onGoPrice: () => void;
}) {
  const v = useVendors(supabase, clientId);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Line[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; payout_no: string; lines: number; total: number } | null>(null);

  const load = useCallback(async () => {
    if (!clientId || !v.vendorId) { setRows(null); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.rpc("payout_not_paid", { p_client_id: clientId, p_vendor: v.vendorId, p_from: from || null, p_to: to || null });
    if (error) setErr(error.message);
    setRows(error ? null : ((data as Line[]) || []));
    setPicked(new Set()); setLimit(PAGE); setLoading(false);
  }, [supabase, clientId, v.vendorId, from, to]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => !q || r.order_no.toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q)
      || (r.product_id || "").toLowerCase().includes(q) || (r.variant_name || "").toLowerCase().includes(q) || r.store_name.toLowerCase().includes(q));
  }, [rows, search]);
  const { sortedData, sortConfig, requestSort } = useTableSort<Line>(filtered);

  const payableShown = useMemo(() => sortedData.filter((r) => r.payable), [sortedData]);
  const allChecked = payableShown.length > 0 && payableShown.every((r) => picked.has(keyOf(r)));
  const noId = (rows || []).filter((r) => r.reason === "no_id").length;
  const noPrice = (rows || []).filter((r) => r.reason === "no_price").length;
  const pickedLines = useMemo(() => (rows || []).filter((r) => picked.has(keyOf(r))), [rows, picked]);
  const pickedQty = pickedLines.reduce((a, r) => a + Number(r.qty), 0);
  const pickedTotal = pickedLines.reduce((a, r) => a + Number(r.total), 0);

  function toggle(r: Line) {
    setPicked((p) => { const n = new Set(p); const k = keyOf(r); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }
  function checkAll() {
    setPicked((p) => {
      const n = new Set(p);
      if (allChecked) payableShown.forEach((r) => n.delete(keyOf(r)));
      else payableShown.forEach((r) => n.add(keyOf(r)));
      return n;
    });
  }

  async function pdfOf(id: string) {
    const { data: d } = await supabase.rpc("payout_lines_of", { p_batch_id: id });
    const det = d as { batch: PayoutBatch | null; lines: PayoutLine[] } | null;
    if (det?.batch) downloadPayoutPdf(det.batch, det.lines);
  }

  async function pay() {
    if (!pickedLines.length || busy || !v.vendor) return;
    if (!window.confirm(`Pay ${v.vendor.name}\n${pickedLines.length} lines · Qty ${num(pickedQty)} · ${rp(pickedTotal)}\n\nSave this payout and generate the XLS + PDF?`)) return;
    setBusy(true); setErr(""); setDone(null);
    const { data, error } = await supabase.rpc("payout_create", {
      p_client_id: clientId, p_vendor: v.vendorId,
      p_keys: pickedLines.map((r) => ({ store_name: r.store_name, order_no: r.order_no, name_key: r.name_key, var_key: r.var_key })), p_note: null,
    });
    if (error) { setBusy(false); setErr(error.message.replace(/^(ALREADY_PAID_OR_UNKNOWN|MISSING_PRICE):\s*/, "")); load(); return; }
    const r = data as { id: string; payout_no: string; lines: number; total: number };
    setDone(r);
    downloadPayout(r.id, "xlsx");
    setTimeout(() => { pdfOf(r.id); }, 600);   // the PDF is built here in the browser from the saved lines
    setBusy(false);
    load();
  }

  const H = (label: string, key: keyof Line, numCol = false) =>
    <SortableHeader label={label} sortKey={key} currentSort={sortConfig} onRequestSort={requestSort} className={numCol ? "num" : undefined} />;

  return (
    <div className="panel">
      <h3>Not Paid</h3>
      <div className="hint">Completed orders of the vendor&apos;s stores not yet paid · date = order completed · tick the lines to pay</div>
      <VendorBar v={v}>
        <div className="fld" style={{ minWidth: 150 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ colorScheme: "dark" }} /></div>
        <div className="fld" style={{ minWidth: 150 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ colorScheme: "dark" }} /></div>
        <div className="fld" style={{ minWidth: 220, flex: 1 }}><label>Search</label><input type="text" placeholder="Store / Order No. / Product ID / Product / Variant" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <button className="btn-ghost" onClick={checkAll} disabled={!payableShown.length}>{allChecked ? "☐ Uncheck All" : "☑ Check All"}</button>
        <button className="btn-gold" onClick={pay} disabled={busy || !pickedLines.length} style={{ padding: "11px 28px", fontSize: 14.5 }}>{busy ? "Saving…" : "Pay to Vendor"}</button>
      </VendorBar>

      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
        {pickedLines.length > 0
          ? <><b style={{ color: "#fff" }}>{pickedLines.length}</b> lines ticked · Qty <b style={{ color: "#fff" }}>{num(pickedQty)}</b> · <b style={{ color: "var(--gold)" }}>{rp(pickedTotal)}</b></>
          : <>{(rows || []).length} open lines{rows && rows.length ? ` · ${rp((rows || []).reduce((a, r) => a + Number(r.total), 0))}` : ""} · tick lines to enable <b>Pay to Vendor</b></>}
      </div>

      {done && (
        <div style={{ border: "1px solid rgba(201,162,39,.5)", background: "rgba(201,162,39,.08)", borderRadius: 12, padding: 14, marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b style={{ color: "var(--gold)" }}>✓ {done.payout_no}</b> saved · {done.lines} lines · {rp(done.total)}
            <div style={{ fontSize: 12, color: "var(--muted)" }}>The XLS and PDF are downloading. Upload the transfer proof and the receipt in Detail Payout.</div>
          </div>
          <button className="btn-ghost" onClick={() => downloadPayout(done.id, "xlsx")}>⬇ XLS</button>
          <button className="btn-ghost" onClick={() => pdfOf(done.id)}>⬇ PDF</button>
          <button className="btn-gold" onClick={() => onPaid(done.id)}>Open Detail Payout</button>
        </div>
      )}
      {err && <div style={{ color: "#f87171", marginBottom: 12, fontSize: 13 }}>✗ {err}</div>}
      {(noId > 0 || noPrice > 0) && !loading && (
        <div style={{ color: "#fbbf24", marginBottom: 10, fontSize: 12.5 }}>
          ⚠ {noPrice > 0 && <>{noPrice} line{noPrice > 1 ? "s have" : " has"} no Harga Beli yet. </>}
          {noId > 0 && <>{noId} line{noId > 1 ? "s have" : " has"} no Product ID (the product is in neither an Earning file nor the SPOS product list). </>}
          Those lines cannot be ticked — a payout needs a price.{" "}
          <button className="btn-gold" onClick={onGoPrice} style={{ padding: "4px 14px", fontSize: 12.5, marginLeft: 6 }}>Set the prices in Harga Beli</button>
        </div>
      )}

      {v.vendors && v.vendors.length === 0 ? <NoVendors /> : !v.vendorId ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: 30 }}>Pick a vendor to see its unpaid orders.</div>
      ) : loading || rows === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
          <table className="tbl day-tbl">
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={checkAll} disabled={!payableShown.length} title="Check all" /></th>
              {H("Date", "completed_at")}{H("Store name", "store_name")}{H("No Pesanan", "order_no")}{H("Product ID", "product_id")}{H("Product", "product_name")}
              {H("Variant ID", "variant_id")}{H("Variant", "variant_name")}{H("Qty", "qty", true)}{H("Harga Beli", "harga_beli", true)}{H("Total", "total", true)}
            </tr></thead>
            <tbody>
              {sortedData.slice(0, limit).map((r) => {
                const on = picked.has(keyOf(r));
                return (
                  <tr key={keyOf(r)} onClick={() => r.payable && toggle(r)} style={{ cursor: r.payable ? "pointer" : "default", opacity: r.payable ? 1 : 0.55, background: on ? "rgba(201,162,39,.10)" : undefined }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={on} disabled={!r.payable} onChange={() => toggle(r)} title={r.reason === "no_id" ? "No Product ID" : r.reason === "no_price" ? "No Harga Beli" : undefined} /></td>
                    <td style={{ fontWeight: 600 }}>{fmtDate(r.completed_at)}</td>
                    <td>{r.store_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.order_no}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5, color: r.reason === "no_id" ? "#f87171" : undefined }}>{r.product_id || (r.reason === "no_id" ? "no Product ID" : "—")}</td>
                    <td style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis" }} title={r.product_name}>{r.product_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.variant_id && r.variant_id !== "-" ? r.variant_id : "—"}</td>
                    <td>{r.variant_name && r.variant_name !== "-" ? r.variant_name : "—"}</td>
                    <td className="num">{num(r.qty)}</td>
                    <td className="num" style={r.reason === "no_price" ? { color: "#f87171" } : undefined}>{r.harga_beli == null ? (r.reason === "no_id" ? "—" : "no price") : rp(r.harga_beli)}</td>
                    <td className="num">{r.payable ? rp(r.total) : "—"}</td>
                  </tr>
                );
              })}
              {sortedData.length === 0 && <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Nothing to pay — every completed order of this vendor is paid.</td></tr>}
            </tbody>
          </table>
          {sortedData.length > limit && (
            <div style={{ textAlign: "center", padding: 12 }}>
              <button className="btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, sortedData.length - limit)} more ({sortedData.length - limit} left)</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
