"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Loader from "@/components/Loader";
import SortableHeader from "@/components/SortableHeader";
import { useTableSort } from "@/hooks/useTableSort";
import { fmtDate } from "@/lib/dates";
import { ScopeBar, downloadPayout, num, rp, useScope, type Supabase } from "./shared";

// Not Paid: completed order lines (Order Completed) that were not paid to the vendor yet.
// Tick lines (or "Check All") and press "Pay to Vendor": the lines are saved as a payout and the XLS + PDF
// (Summary / Detail) are downloaded. A line needs a Product ID and a Harga Beli (Harga Beli sub page) to be payable.

type Line = {
  completed_at: string; order_no: string; name_key: string; var_key: string; product_id: string | null; product_name: string;
  variant_id: string | null; variant_name: string; qty: number; harga_beli: number | null; total: number; payable: boolean;
};
const PAGE = 300;
const keyOf = (l: Pick<Line, "order_no" | "name_key" | "var_key">) => `${l.order_no}||${l.name_key}||${l.var_key}`;

export default function NotPaidPanel({ supabase, clientId, onPaid }: {
  supabase: Supabase; clientId: string; onPaid: (batchId: string) => void;
}) {
  const scope = useScope(supabase, clientId);
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
    if (!clientId || !scope.store) { setRows(null); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.rpc("payout_not_paid", {
      p_client_id: clientId, p_store: scope.store, p_from: from || null, p_to: to || null,
    });
    if (error) setErr(error.message);
    setRows(error ? null : ((data as Line[]) || []));
    setPicked(new Set()); setLimit(PAGE); setLoading(false);
  }, [supabase, clientId, scope.store, from, to]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => !q || r.order_no.toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q) || (r.product_id || "").toLowerCase().includes(q) || (r.variant_name || "").toLowerCase().includes(q));
  }, [rows, search]);
  const { sortedData, sortConfig, requestSort } = useTableSort<Line>(filtered);

  const payableShown = useMemo(() => sortedData.filter((r) => r.payable), [sortedData]);
  const allChecked = payableShown.length > 0 && payableShown.every((r) => picked.has(keyOf(r)));
  const missing = (rows || []).filter((r) => !r.payable).length;
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

  async function pay() {
    if (!pickedLines.length || busy) return;
    if (!window.confirm(`Pay ${scope.store}\n${pickedLines.length} lines · Qty ${num(pickedQty)} · ${rp(pickedTotal)}\n\nSave this payout and generate the XLS + PDF?`)) return;
    setBusy(true); setErr(""); setDone(null);
    const { data, error } = await supabase.rpc("payout_create", {
      p_client_id: clientId, p_store: scope.store, p_city: scope.cityOfStore,
      p_keys: pickedLines.map((r) => ({ order_no: r.order_no, name_key: r.name_key, var_key: r.var_key })), p_note: null,
    });
    setBusy(false);
    if (error) { setErr(error.message.replace(/^(ALREADY_PAID_OR_UNKNOWN|MISSING_PRICE):\s*/, "")); load(); return; }
    const r = data as { id: string; payout_no: string; lines: number; total: number };
    setDone(r);
    downloadPayout(r.id, "xlsx");
    setTimeout(() => downloadPayout(r.id, "pdf"), 700);
    load();
  }

  const H = (label: string, key: keyof Line, numCol = false) =>
    <SortableHeader label={label} sortKey={key} currentSort={sortConfig} onRequestSort={requestSort} className={numCol ? "num" : undefined} />;

  return (
    <div className="panel">
      <h3>Not Paid</h3>
      <div className="hint">Completed orders not yet paid to the vendor · date = order completed · tick the lines to pay</div>
      <ScopeBar scope={scope}>
        <div className="fld" style={{ minWidth: 150 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ colorScheme: "dark" }} /></div>
        <div className="fld" style={{ minWidth: 150 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ colorScheme: "dark" }} /></div>
        <div className="fld" style={{ minWidth: 220, flex: 1 }}><label>Search</label><input type="text" placeholder="Order No. / Product ID / Product / Variant" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <button className="btn-ghost" onClick={checkAll} disabled={!payableShown.length}>{allChecked ? "☐ Uncheck All" : "☑ Check All"}</button>
      </ScopeBar>

      {done && (
        <div style={{ border: "1px solid rgba(201,162,39,.5)", background: "rgba(201,162,39,.08)", borderRadius: 12, padding: 14, marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b style={{ color: "var(--gold)" }}>✓ {done.payout_no}</b> saved · {done.lines} lines · {rp(done.total)}
            <div style={{ fontSize: 12, color: "var(--muted)" }}>The XLS and PDF are downloading. You can download them again here or in Detail Payout.</div>
          </div>
          <button className="btn-ghost" onClick={() => downloadPayout(done.id, "xlsx")}>⬇ XLS</button>
          <button className="btn-ghost" onClick={() => downloadPayout(done.id, "pdf")}>⬇ PDF</button>
          <button className="btn-gold" onClick={() => onPaid(done.id)}>Open Detail Payout</button>
        </div>
      )}
      {err && <div style={{ color: "#f87171", marginBottom: 12, fontSize: 13 }}>✗ {err}</div>}
      {missing > 0 && !loading && (
        <div style={{ color: "#fbbf24", marginBottom: 10, fontSize: 12.5 }}>
          ⚠ {missing} line{missing > 1 ? "s have" : " has"} no Product ID or no Harga Beli yet and cannot be ticked. Set the price in the <b>Harga Beli</b> sub page
          (a Product ID appears once an Earning file with that product is uploaded).
        </div>
      )}

      {!scope.store ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: 30 }}>Pick a dealer to see its unpaid orders.</div>
      ) : loading || rows === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
          <table className="tbl day-tbl">
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={checkAll} disabled={!payableShown.length} title="Check all" /></th>
              {H("Date", "completed_at")}{H("No Pesanan", "order_no")}{H("Product ID", "product_id")}{H("Product", "product_name")}
              {H("Variant ID", "variant_id")}{H("Variant", "variant_name")}{H("Qty", "qty", true)}{H("Harga Beli", "harga_beli", true)}{H("Total", "total", true)}
            </tr></thead>
            <tbody>
              {sortedData.slice(0, limit).map((r) => {
                const on = picked.has(keyOf(r));
                return (
                  <tr key={keyOf(r)} onClick={() => r.payable && toggle(r)} style={{ cursor: r.payable ? "pointer" : "default", opacity: r.payable ? 1 : 0.55, background: on ? "rgba(201,162,39,.10)" : undefined }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={on} disabled={!r.payable} onChange={() => toggle(r)} /></td>
                    <td style={{ fontWeight: 600 }}>{fmtDate(r.completed_at)}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.order_no}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.product_id || "—"}</td>
                    <td style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis" }} title={r.product_name}>{r.product_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.variant_id && r.variant_id !== "-" ? r.variant_id : "—"}</td>
                    <td>{r.variant_name && r.variant_name !== "-" ? r.variant_name : "—"}</td>
                    <td className="num">{num(r.qty)}</td>
                    <td className="num" style={r.harga_beli == null ? { color: "#f87171" } : undefined}>{r.harga_beli == null ? "no price" : rp(r.harga_beli)}</td>
                    <td className="num">{r.payable ? rp(r.total) : "—"}</td>
                  </tr>
                );
              })}
              {sortedData.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Nothing to pay — every completed order of this dealer is paid.</td></tr>}
            </tbody>
          </table>
          {sortedData.length > limit && (
            <div style={{ textAlign: "center", padding: 12 }}>
              <button className="btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, sortedData.length - limit)} more ({sortedData.length - limit} left)</button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 14 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {pickedLines.length > 0
            ? <><b style={{ color: "#fff" }}>{pickedLines.length}</b> lines ticked · Qty <b style={{ color: "#fff" }}>{num(pickedQty)}</b> · <b style={{ color: "var(--gold)" }}>{rp(pickedTotal)}</b></>
            : <>{(rows || []).length} open lines{rows && rows.length ? ` · ${rp((rows || []).reduce((a, r) => a + Number(r.total), 0))}` : ""}</>}
        </div>
        {pickedLines.length > 0 && (
          <button className="btn-gold" onClick={pay} disabled={busy} style={{ padding: "11px 34px", fontSize: 15 }}>{busy ? "Saving…" : "Pay to Vendor"}</button>
        )}
      </div>
    </div>
  );
}
