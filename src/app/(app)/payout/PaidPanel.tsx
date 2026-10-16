"use client";

import { useCallback, useEffect, useState } from "react";
import Loader from "@/components/Loader";
import { fmtDate } from "@/lib/dates";
import type { PayoutBatch } from "@/lib/payoutExport";
import { ScopeBar, downloadPayout, num, rp, useScope, type Supabase } from "./shared";

// Paid: the saved payouts (newest first). Open one in Detail Payout, download its XLS / PDF again,
// or cancel it (its lines go back to Not Paid).
export default function PaidPanel({ supabase, clientId, onOpen }: {
  supabase: Supabase; clientId: string; onOpen: (batchId: string) => void;
}) {
  const scope = useScope(supabase, clientId);
  const [rows, setRows] = useState<PayoutBatch[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!clientId) return;
    const { data, error } = await supabase.rpc("payout_list", { p_client_id: clientId, p_store: scope.store || null, p_city: scope.city || null });
    if (error) setErr(error.message);
    setRows(error ? [] : ((data as PayoutBatch[]) || []));
  }, [supabase, clientId, scope.store, scope.city]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function cancel(b: PayoutBatch) {
    if (!window.confirm(`Cancel ${b.payout_no}?\nIts ${b.line_count} lines go back to Not Paid.`)) return;
    const { error } = await supabase.rpc("payout_cancel", { p_batch_id: b.id });
    if (error) setErr(error.message); else load();
  }

  return (
    <div className="panel">
      <h3>Paid</h3>
      <div className="hint">Payouts already paid to the vendor</div>
      <ScopeBar scope={scope} />
      {err && <div style={{ color: "#f87171", marginBottom: 10, fontSize: 13 }}>✗ {err}</div>}
      {rows === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
          <table className="tbl day-tbl">
            <thead><tr>
              <th>Payout No</th><th>Date</th><th>Dealer</th><th className="num">Orders</th><th className="num">Lines</th>
              <th className="num">Qty</th><th className="num">Total</th><th>By</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} style={{ cursor: "pointer" }} onClick={() => onOpen(b.id)}>
                  <td style={{ fontWeight: 700, color: "var(--gold)" }}>{b.payout_no}</td>
                  <td>{fmtDate(b.created_at.slice(0, 10))}</td>
                  <td>{b.store_name}</td>
                  <td className="num">{num(b.order_count)}</td>
                  <td className="num">{num(b.line_count)}</td>
                  <td className="num">{num(b.total_qty)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{rp(b.total)}</td>
                  <td>{b.created_by_name || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn-ghost" onClick={() => downloadPayout(b.id, "xlsx")}>⬇ XLS</button>{" "}
                    <button className="btn-ghost" onClick={() => downloadPayout(b.id, "pdf")}>⬇ PDF</button>{" "}
                    <button className="btn-ghost" onClick={() => cancel(b)} style={{ color: "#f87171" }}>Cancel</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No payouts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
