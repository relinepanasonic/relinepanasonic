"use client";

import { useEffect, useMemo, useState } from "react";
import Loader from "@/components/Loader";
import { dateOrDash, summarize, type PayoutBatch, type PayoutLine } from "@/lib/payoutExport";
import { downloadPayout, num, rp, tabBtn, type Supabase } from "./shared";

// Detail Payout: one payout with the same two views as the XLS / PDF: Summary (per product) and Detail (per order line).
export default function DetailPanel({ supabase, clientId, batchId, onSelect }: {
  supabase: Supabase; clientId: string; batchId: string | null; onSelect: (id: string) => void;
}) {
  const [list, setList] = useState<PayoutBatch[]>([]);
  const [data, setData] = useState<{ batch: PayoutBatch | null; lines: PayoutLine[] } | null>(null);
  const [view, setView] = useState<"summary" | "detail">("summary");

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data: l } = await supabase.rpc("payout_list", { p_client_id: clientId, p_store: null, p_city: null });
      setList((l as PayoutBatch[]) || []);
    })();
  }, [supabase, clientId, batchId]);

  useEffect(() => {
    if (!batchId) return;
    (async () => {
      setData(null);
      const { data: d } = await supabase.rpc("payout_lines_of", { p_batch_id: batchId });
      setData((d as { batch: PayoutBatch | null; lines: PayoutLine[] }) || { batch: null, lines: [] });
    })();
  }, [supabase, batchId]);

  const sum = useMemo(() => summarize(data?.lines || []), [data]);
  const b = data?.batch;

  return (
    <div className="panel">
      <h3>Detail Payout</h3>
      <div className="hint">Pick a payout to see what was paid, per product and per order</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <div className="fld" style={{ minWidth: 320 }}>
          <label>Payout</label>
          <select value={batchId || ""} onChange={(e) => e.target.value && onSelect(e.target.value)}>
            <option value="">{list.length ? "Select a payout…" : "No payouts yet"}</option>
            {list.map((x) => <option key={x.id} value={x.id}>{x.payout_no} · {x.store_name} · {rp(x.total)}</option>)}
          </select>
        </div>
        {b && (
          <>
            <button className="btn-ghost" onClick={() => downloadPayout(b.id, "xlsx")}>⬇ XLS</button>
            <button className="btn-ghost" onClick={() => downloadPayout(b.id, "pdf")}>⬇ PDF</button>
          </>
        )}
      </div>

      {!batchId ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: 30 }}>Select a payout above, or press a row in Paid.</div>
      ) : data === null ? <Loader center /> : !b ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: 30 }}>This payout no longer exists.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button onClick={() => setView("summary")} style={tabBtn(view === "summary")}>Summary</button>
            <button onClick={() => setView("detail")} style={tabBtn(view === "detail")}>Detail</button>
          </div>
          {view === "summary" ? (
            <div className="tbl-wrap" style={{ maxHeight: "58vh" }}>
              <table className="tbl day-tbl">
                <thead><tr><th>ID Product</th><th>Nama Prod</th><th className="num">Qty</th><th className="num">Harga Beli</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {sum.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.product_id || "—"}</td>
                      <td style={{ maxWidth: 480, overflow: "hidden", textOverflow: "ellipsis" }} title={r.product_name}>{r.product_name}</td>
                      <td className="num">{num(r.qty)}</td><td className="num">{rp(r.harga_beli)}</td><td className="num">{rp(r.total)}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 800, borderTop: "2px solid rgba(201,162,39,.4)" }}>
                    <td></td><td>TOTAL</td><td className="num">{num(sum.reduce((a, r) => a + r.qty, 0))}</td><td></td>
                    <td className="num" style={{ color: "var(--gold)" }}>{rp(sum.reduce((a, r) => a + r.total, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="tbl-wrap" style={{ maxHeight: "58vh" }}>
              <table className="tbl day-tbl">
                <thead><tr>
                  <th>No Pesanan</th><th>Tgl Kirim</th><th>Tgl Withdraw</th><th>ID Prod</th><th>Nama Prod</th>
                  <th className="num">Qty</th><th className="num">Harga Beli</th><th className="num">Total</th>
                </tr></thead>
                <tbody>
                  {(data.lines || []).map((l, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{l.order_no}</td>
                      <td>{dateOrDash(l.shipped_at)}</td><td>{dateOrDash(l.withdraw_at)}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{l.product_id || "—"}</td>
                      <td style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis" }} title={l.product_name || ""}>{l.product_name}</td>
                      <td className="num">{num(l.qty)}</td><td className="num">{rp(l.harga_beli)}</td><td className="num">{rp(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
