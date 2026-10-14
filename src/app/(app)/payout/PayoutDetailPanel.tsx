"use client";

import { useEffect, useState, useMemo } from "react";
import type { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import SortableHeader from "@/components/SortableHeader";
import { useTableSort } from "@/hooks/useTableSort";

// Payout Detail: the SKUs behind one payout — quantity, Modal (cost price) and
// quantity x Modal, the grand total, and the CSV for the ERP. The lines are a
// snapshot taken when the payout was proceeded.

type Supabase = ReturnType<typeof createClient>;
const rpFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const fmtDate = (iso: string | null) => (iso ? new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Batch = {
  id: string; payout_no: string | null; store_name: string; dealer_city: string | null;
  date_from: string | null; date_to: string | null; days: number; total_modal: number; line_count: number;
  qty_missing: number; modal_missing: number; note: string | null; created_by_name: string | null; created_at: string;
};
type Line = { kode_produk: string | null; nama_produk: string | null; qty: number; modal_unit: number | null; total_modal: number; qty_missing: boolean; modal_missing: boolean };
type Detail = { batch: Batch; days: string[]; lines: Line[] };

export default function PayoutDetailPanel({ supabase, batchId, onSelect, onBack }: {
  supabase: Supabase; batchId: string | null; onSelect: (id: string | null) => void; onBack: () => void;
}) {
  const [list, setList] = useState<Batch[] | null>(null);
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [withTotal, setWithTotal] = useState(false);

  // all payouts, newest first; open the newest one when none is chosen
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("payout_list");
      const rows = (data as Batch[]) || [];
      setList(rows);
      if (!batchId && rows.length) onSelect(rows[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    (async () => {
      if (!batchId) { setD(null); return; }
      setLoading(true);
      const { data, error } = await supabase.rpc("payout_detail", { p_id: batchId });
      if (error) alert(error.message);
      setD((data as Detail) || null);
      setLoading(false);
    })();
  }, [supabase, batchId]);

  const lines = useMemo(() => d?.lines ?? [], [d]);
  const { sortedData, sortConfig, requestSort } = useTableSort<Line>(lines);
  const totalQty = lines.reduce((a, l) => a + (l.qty || 0), 0);
  const totalModal = lines.reduce((a, l) => a + (l.total_modal || 0), 0);

  function downloadCsv() {
    if (!d) return;
    const b = d.batch;
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["payout_no", "dealer", "city", "date_from", "date_to", "product_code", "product_name", "qty", "modal_unit", "total_modal"];
    const rows = lines.map((l) => [
      q(b.payout_no), q(b.store_name), q(b.dealer_city), b.date_from ?? "", b.date_to ?? "",
      q(l.kode_produk), q(l.nama_produk), l.qty, l.modal_unit ?? "", Math.round(l.total_modal || 0),
    ].join(","));
    if (withTotal) rows.push([q(b.payout_no), q(b.store_name), q(b.dealer_city), b.date_from ?? "", b.date_to ?? "", q("TOTAL"), q(""), totalQty, "", Math.round(totalModal)].join(","));
    const csv = "﻿" + [head.join(","), ...rows].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `payout-${b.payout_no || b.id}-${b.store_name.replace(/[^A-Za-z0-9]+/g, "_")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function cancelPayout() {
    if (!d) return;
    if (!confirm(`Cancel payout ${d.batch.payout_no}?\n\nIts ${d.batch.days} day(s) become payable again and its SKU lines are deleted. This cannot be undone.`)) return;
    const { error } = await supabase.rpc("payout_cancel", { p_id: d.batch.id });
    if (error) { alert(error.message); return; }
    onSelect(null);
    setList((l) => (l || []).filter((x) => x.id !== d.batch.id));
    setD(null);
    onBack();
  }

  if (list === null) return <Loader center />;

  if (list.length === 0) {
    return (
      <div className="panel">
        <div className="coming">
          <div className="big">🧾</div>
          <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>No payout yet</h3>
          <p style={{ maxWidth: 420, margin: 0 }}>Go to Earning, tick the days to pay and press Proceed Payment. The payout appears here with its SKU table and the ERP CSV.</p>
          <button className="btn-gold" onClick={onBack} style={{ marginTop: 14, padding: "10px 26px" }}>Go to Earning</button>
        </div>
      </div>
    );
  }

  const b = d?.batch;
  return (
    <div className="fin-compact">
      <div className="filterbar">
        <div className="fld" style={{ minWidth: 320 }}>
          <label>Payout</label>
          <select value={batchId ?? ""} onChange={(e) => onSelect(e.target.value || null)}>
            {list.map((x) => (
              <option key={x.id} value={x.id}>{x.payout_no} · {x.store_name} · {fmtDate(x.date_from)}{x.date_to !== x.date_from ? ` → ${fmtDate(x.date_to)}` : ""} · {rpFull(x.total_modal)}</option>
            ))}
          </select>
        </div>
        {loading && <Loader />}
      </div>

      {!d || !b ? (loading ? <Loader center /> : null) : (
        <>
          <div className="kpi-grid kpi-grid-5">
            <div className="kpi kpi-hero"><div className="kpi-icon">🏷️</div><div className="lbl">Total Modal (qty × modal)</div><div className="val">{rpFull(totalModal)}</div></div>
            <div className="kpi"><div className="kpi-icon">📦</div><div className="lbl">Total SKU Qty</div><div className="val">{totalQty.toLocaleString("id-ID")}</div></div>
            <div className="kpi"><div className="kpi-icon">🧮</div><div className="lbl">SKU Lines</div><div className="val">{lines.length.toLocaleString("id-ID")}</div></div>
            <div className="kpi"><div className="kpi-icon">📅</div><div className="lbl">Days in this payout</div><div className="val">{b.days}</div></div>
            <div className="kpi"><div className="kpi-icon">🏬</div><div className="lbl">Dealer</div><div className="val" style={{ fontSize: 15 }}>{b.store_name}</div></div>
          </div>

          <div className="panel" style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 22px", fontSize: 13, color: "#cdd9f0" }}>
              <span>Payout <b style={{ color: "#fff" }}>{b.payout_no}</b></span>
              <span>City <b style={{ color: "#fff" }}>{b.dealer_city || "—"}</b></span>
              <span>Period <b style={{ color: "#fff" }}>{fmtDate(b.date_from)}{b.date_to !== b.date_from ? ` → ${fmtDate(b.date_to)}` : ""}</b></span>
              <span>Proceeded <b style={{ color: "#fff" }}>{fmtDate(b.created_at)}</b>{b.created_by_name ? ` by ${b.created_by_name}` : ""}</span>
            </div>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {d.days.map((x) => <span key={x} style={{ fontSize: 11.5, padding: "2px 9px", borderRadius: 999, border: "1px solid rgba(201,162,39,.35)", color: "var(--gold)" }}>{fmtDate(x)}</span>)}
            </div>
            {(b.qty_missing > 0 || b.modal_missing > 0) && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: "#fbbf24", lineHeight: 1.55 }}>
                {b.qty_missing > 0 && <div>⚠ {b.qty_missing} SKU line(s) have no quantity: their orders are not in the Operational upload (Order.completed). Upload it for this dealer and month, then cancel and proceed this payout again.</div>}
                {b.modal_missing > 0 && <div>⚠ {b.modal_missing} SKU line(s) have no Modal price: enter it in Finance Detail → Modal Product, then cancel and proceed this payout again.</div>}
              </div>
            )}
          </div>

          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0 }}>SKU Detail</h3>
                <div className="hint">Qty from Order.completed (minus returns) · Modal from Modal Product · total = qty × modal</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#cdd9f0", cursor: "pointer" }}>
                  <input type="checkbox" checked={withTotal} onChange={(e) => setWithTotal(e.target.checked)} /> add a TOTAL row to the CSV
                </label>
                <button className="btn-gold" onClick={downloadCsv} disabled={lines.length === 0} style={{ padding: "10px 22px" }}>⬇ Generate CSV for ERP</button>
              </div>
            </div>

            <div className="tbl-wrap" style={{ maxHeight: 480, marginTop: 10 }}>
              <table className="tbl">
                <thead><tr>
                  <SortableHeader label="Product Name" sortKey="nama_produk" currentSort={sortConfig} onRequestSort={requestSort} />
                  <SortableHeader label="Product Code" sortKey="kode_produk" currentSort={sortConfig} onRequestSort={requestSort} />
                  <SortableHeader label="Qty" sortKey="qty" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                  <SortableHeader label="Modal (per unit)" sortKey="modal_unit" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                  <SortableHeader label="Total Modal (qty × modal)" sortKey="total_modal" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
                </tr></thead>
                <tbody>
                  {sortedData.map((l, i) => (
                    <tr key={`${l.kode_produk}-${i}`}>
                      <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.nama_produk || undefined}>{l.nama_produk || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12.5, whiteSpace: "nowrap" }}>{l.kode_produk || "—"}</td>
                      <td className="num" style={{ color: l.qty_missing ? "#fbbf24" : undefined }} title={l.qty_missing ? "Some orders of this SKU are not in the Operational upload" : undefined}>{l.qty.toLocaleString("id-ID")}{l.qty_missing ? " ⚠" : ""}</td>
                      <td className="num" style={{ color: l.modal_missing ? "#fbbf24" : undefined }} title={l.modal_missing ? "No Modal price in Modal Product" : undefined}>{l.modal_unit == null ? "⚠ not set" : rpFull(l.modal_unit)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{rpFull(l.total_modal)}</td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No SKU lines: these days have no per-SKU rows. They come from Shopee&apos;s new Income layout.</td></tr>
                  )}
                </tbody>
                {lines.length > 0 && (
                  <tfoot>
                    <tr style={{ fontWeight: 800 }}>
                      <td colSpan={2} style={{ textAlign: "right" }}>TOTAL</td>
                      <td className="num">{totalQty.toLocaleString("id-ID")}</td>
                      <td />
                      <td className="num" style={{ color: "var(--gold)" }}>{rpFull(totalModal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, flexWrap: "wrap", gap: 10 }}>
              <button className="btn-ghost" onClick={onBack}>← Back to Earning</button>
              <button className="btn-ghost" onClick={cancelPayout} style={{ color: "#f87171", borderColor: "rgba(239,68,68,.35)" }}>Cancel this payout</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
