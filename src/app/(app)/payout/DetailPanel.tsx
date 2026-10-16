"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Loader from "@/components/Loader";
import { fmtDate } from "@/lib/dates";
import { dateOrDash, summarize, type PayoutBatch, type PayoutLine } from "@/lib/payoutExport";
import { downloadPayoutPdf } from "@/lib/payoutPdfClient";
import { NoVendors, VendorBar, downloadPayout, num, rp, tabBtn, useVendors, type Supabase } from "./shared";

// Detail Payout: the payout register, one row per payout:
//   Date Payout | No Payout | Vendor | Store name | Total Payout | Proof (transfer proof) | Receipt | Status
// Press a row to see its Summary / Detail (and download the XLS / PDF again).
// Proof and Receipt are uploaded here; the status follows: Waiting transfer -> Transferred (proof) -> Completed (receipt).
const STATUS_COLOR: Record<string, string> = { "Waiting transfer": "#fbbf24", Transferred: "#60a5fa", Completed: "#86efac" };

export default function DetailPanel({ supabase, clientId, batchId, onSelect }: {
  supabase: Supabase; clientId: string; batchId: string | null; onSelect: (id: string | null) => void;
}) {
  const v = useVendors(supabase, clientId);
  const [list, setList] = useState<PayoutBatch[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState("");

  const load = useCallback(async () => {
    if (!clientId) return;
    const { data, error } = await supabase.rpc("payout_list", { p_client_id: clientId, p_vendor: v.vendorId || null });
    if (error) setMsg({ ok: false, text: error.message });
    setList(error ? [] : ((data as PayoutBatch[]) || []));
  }, [supabase, clientId, v.vendorId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // upload straight to storage with a one-time link made by the server (no request size limit), then record it
  async function upload(b: PayoutBatch, kind: "proof" | "receipt", file: File) {
    setBusyKey(`${b.id}:${kind}`); setMsg(null);
    try {
      const sign = await fetch("/api/payout/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign", batch: b.id, kind, filename: file.name }) });
      const sj = await sign.json();
      if (!sign.ok) throw new Error(sj.error || "Could not prepare the upload");
      const up = await supabase.storage.from("payout-files").uploadToSignedUrl(sj.path, sj.token, file);
      if (up.error) throw new Error(up.error.message);
      const commit = await fetch("/api/payout/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit", batch: b.id, kind, path: sj.path, name: file.name }) });
      const cj = await commit.json();
      if (!commit.ok) throw new Error(cj.error || "Could not save the file");
      setMsg({ ok: true, text: `${kind === "proof" ? "Transfer proof" : "Receipt"} saved for ${b.payout_no}. Status: ${cj.status}.` });
      load();
    } catch (e) { setMsg({ ok: false, text: String((e as Error).message || e) }); }
    setBusyKey("");
  }
  async function remove(b: PayoutBatch, kind: "proof" | "receipt") {
    if (!window.confirm(`Remove the ${kind === "proof" ? "transfer proof" : "receipt"} of ${b.payout_no}?`)) return;
    const r = await fetch("/api/payout/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", batch: b.id, kind }) });
    if (!r.ok) setMsg({ ok: false, text: (await r.json().catch(() => ({}))).error || "Could not remove" });
    load();
  }
  async function cancel(b: PayoutBatch) {
    if (!window.confirm(`Cancel ${b.payout_no}?\nIts ${b.line_count} lines go back to Not Paid.`)) return;
    const { error } = await supabase.rpc("payout_cancel", { p_batch_id: b.id });
    if (error) setMsg({ ok: false, text: error.message }); else { if (batchId === b.id) onSelect(null); load(); }
  }

  return (
    <div className="panel">
      <h3>Detail Payout</h3>
      <div className="hint">Every payout with its transfer proof and receipt · press a row for its Summary / Detail</div>
      <VendorBar v={v} />
      {v.vendors && v.vendors.length === 0 && <NoVendors />}
      {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", marginBottom: 10, fontSize: 13 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}
      {list === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
          <table className="tbl day-tbl">
            <thead><tr>
              <th>Date Payout</th><th>No Payout</th><th>Vendor</th><th>Store name</th><th className="num">Total Payout</th>
              <th>Proof</th><th>Receipt</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id} style={{ cursor: "pointer" }} onClick={() => onSelect(b.id)}>
                  <td>{fmtDate(b.created_at.slice(0, 10))}</td>
                  <td style={{ fontWeight: 700, color: "var(--gold)" }}>{b.payout_no}</td>
                  <td>{b.vendor_name || "—"}</td>
                  <td style={{ whiteSpace: "normal", maxWidth: 260 }}>{b.store_name}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{rp(b.total)}</td>
                  {(["proof", "receipt"] as const).map((kind) => {
                    const name = kind === "proof" ? b.proof_name : b.receipt_name;
                    return (
                      <td key={kind} onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                        {name ? (
                          <>
                            <a href={`/api/payout/file?batch=${b.id}&kind=${kind}`} target="_blank" rel="noreferrer" title={name} style={{ color: "#e8edf8", textDecoration: "underline", display: "inline-block", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" }}>{name}</a>{" "}
                            <button onClick={() => remove(b, kind)} title="Remove" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
                          </>
                        ) : (
                          <UploadButton busy={busyKey === `${b.id}:${kind}`} label={kind === "proof" ? "Upload proof" : "Upload receipt"} onFile={(f) => upload(b, kind, f)} />
                        )}
                      </td>
                    );
                  })}
                  <td><span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: STATUS_COLOR[b.status || ""] || "var(--muted)", border: `1px solid ${(STATUS_COLOR[b.status || ""] || "#888")}55`, background: `${(STATUS_COLOR[b.status || ""] || "#888")}18` }}>{b.status || "—"}</span></td>
                  <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                    <button className="btn-ghost" onClick={() => cancel(b)} style={{ color: "#f87171" }}>Cancel</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No payouts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {batchId && <PayoutView supabase={supabase} batchId={batchId} onClose={() => onSelect(null)} />}
    </div>
  );
}

function UploadButton({ label, busy, onFile }: { label: string; busy: boolean; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); if (ref.current) ref.current.value = ""; }} />
      <button className="btn-ghost" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Uploading…" : `⬆ ${label}`}</button>
    </>
  );
}

// the payout's Summary / Detail (same as the XLS / PDF), as a pop-up
function PayoutView({ supabase, batchId, onClose }: { supabase: Supabase; batchId: string; onClose: () => void }) {
  const [data, setData] = useState<{ batch: PayoutBatch | null; lines: PayoutLine[] } | null>(null);
  const [view, setView] = useState<"summary" | "detail">("summary");
  useEffect(() => {
    (async () => {
      const { data: d } = await supabase.rpc("payout_lines_of", { p_batch_id: batchId });
      setData((d as { batch: PayoutBatch | null; lines: PayoutLine[] }) || { batch: null, lines: [] });
    })();
  }, [supabase, batchId]);
  const sum = useMemo(() => summarize(data?.lines || []), [data]);
  const b = data?.batch;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(4,9,20,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(98vw,1500px)", maxHeight: "92vh", overflow: "auto", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.25))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{b ? `${b.payout_no} · ${b.vendor_name || b.store_name}` : "Payout"}</div>
          <div style={{ display: "flex", gap: 8 }}>
            {b && <button className="btn-ghost" onClick={() => downloadPayout(b.id, "xlsx")}>⬇ XLS</button>}
            {b && data && <button className="btn-ghost" onClick={() => downloadPayoutPdf(b, data.lines)}>⬇ PDF</button>}
            <button className="btn-ghost" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        {data === null ? <Loader center /> : !b ? <div style={{ color: "var(--muted)", padding: 20 }}>This payout no longer exists.</div> : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={() => setView("summary")} style={tabBtn(view === "summary")}>Summary</button>
              <button onClick={() => setView("detail")} style={tabBtn(view === "detail")}>Detail</button>
            </div>
            {view === "summary" ? (
              <div className="tbl-wrap" style={{ maxHeight: "60vh" }}>
                <table className="tbl day-tbl">
                  <thead><tr><th>ID Product</th><th>Nama Prod</th><th>ID Variasi</th><th>Variasi</th><th className="num">Qty</th><th className="num">Harga Beli</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {sum.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.product_id || "—"}</td>
                        <td style={{ maxWidth: 460, overflow: "hidden", textOverflow: "ellipsis" }} title={r.product_name}>{r.product_name}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.variant_id}</td><td>{r.variant_name}</td>
                        <td className="num">{num(r.qty)}</td><td className="num">{rp(r.harga_beli)}</td><td className="num">{rp(r.total)}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 800, borderTop: "2px solid rgba(201,162,39,.4)" }}>
                      <td></td><td>TOTAL</td><td></td><td></td><td className="num">{num(sum.reduce((a, r) => a + r.qty, 0))}</td><td></td>
                      <td className="num" style={{ color: "var(--gold)" }}>{rp(sum.reduce((a, r) => a + r.total, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="tbl-wrap" style={{ maxHeight: "60vh" }}>
                <table className="tbl day-tbl">
                  <thead><tr>
                    <th>No Pesanan</th><th>Store</th><th>Tgl Kirim</th><th>Tgl Withdraw</th><th>ID Prod</th><th>Nama Prod</th><th>ID Variasi</th><th>Variasi</th>
                    <th className="num">Qty</th><th className="num">Harga Beli</th><th className="num">Total</th>
                  </tr></thead>
                  <tbody>
                    {data.lines.map((l, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{l.order_no}</td><td>{l.store_name}</td>
                        <td>{dateOrDash(l.shipped_at)}</td><td>{dateOrDash(l.withdraw_at)}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{l.product_id || "—"}</td>
                        <td style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis" }} title={l.product_name || ""}>{l.product_name}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{l.variant_id || "-"}</td><td>{l.variant_name || "-"}</td>
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
    </div>, document.body);
}
