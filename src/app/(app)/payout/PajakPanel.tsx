"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Loader from "@/components/Loader";
import { fmtDate } from "@/lib/dates";
import type { PayoutBatch } from "@/lib/payoutExport";
import { FILE_LABEL, FileCell, NoVendors, VendorBar, fileNameOf, removePayoutFile, rp, uploadPayoutFile, useVendors, type FileKind, type Supabase } from "./shared";

// Pajak: the tax documents of buying from the vendor, one row per payout: the Faktur Pajak and the Bukti Potong.
// A payout is "Complete" when both are uploaded; the rest show what is still missing (filter "Missing only").
const TAX_COLOR: Record<string, string> = { Complete: "#86efac", "Missing both": "#f87171", "Faktur Pajak missing": "#fbbf24", "Bukti Potong missing": "#fbbf24" };

export default function PajakPanel({ supabase, clientId, onOpen }: { supabase: Supabase; clientId: string; onOpen: (batchId: string) => void }) {
  const v = useVendors(supabase, clientId);
  const [list, setList] = useState<PayoutBatch[] | null>(null);
  const [missingOnly, setMissingOnly] = useState(false);
  const [search, setSearch] = useState("");
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

  async function upload(b: PayoutBatch, kind: FileKind, file: File) {
    setBusyKey(`${b.id}:${kind}`); setMsg(null);
    try { await uploadPayoutFile(supabase, b.id, kind, file); setMsg({ ok: true, text: `${FILE_LABEL[kind]} saved for ${b.payout_no}.` }); load(); }
    catch (e) { setMsg({ ok: false, text: String((e as Error).message || e) }); }
    setBusyKey("");
  }
  async function remove(b: PayoutBatch, kind: FileKind) {
    if (!window.confirm(`Remove the ${FILE_LABEL[kind]} of ${b.payout_no}?`)) return;
    try { await removePayoutFile(b.id, kind); setMsg({ ok: true, text: `${FILE_LABEL[kind]} of ${b.payout_no} removed.` }); }
    catch (e) { setMsg({ ok: false, text: String((e as Error).message || e) }); }
    load();
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list || []).filter((b) => (!missingOnly || b.tax_status !== "Complete")
      && (!q || (b.payout_no || "").toLowerCase().includes(q) || (b.vendor_name || "").toLowerCase().includes(q) || b.store_name.toLowerCase().includes(q)));
  }, [list, missingOnly, search]);
  const complete = (list || []).filter((b) => b.tax_status === "Complete").length;

  return (
    <div className="panel">
      <h3>Pajak</h3>
      <div className="hint">Faktur Pajak and Bukti Potong of buying from the vendor · one row per payout · upload them here or in Detail Payout</div>
      <VendorBar v={v}>
        <div className="fld" style={{ minWidth: 240, flex: 1 }}><label>Search</label><input type="text" placeholder="Payout No / Vendor / Store" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#cdd9f0", paddingBottom: 10 }}>
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing only
        </label>
      </VendorBar>
      {v.vendors && v.vendors.length === 0 && <NoVendors />}
      {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", marginBottom: 10, fontSize: 13 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}
      {list === null ? <Loader center /> : (
        <>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
            <b style={{ color: "#fff" }}>{complete}</b> of {list.length} payouts have both documents
          </div>
          <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
            <table className="tbl day-tbl">
              <thead><tr>
                <th>Date Payout</th><th>No Payout</th><th>Vendor</th><th>Store name</th><th className="num">Total Payout</th>
                <th>Faktur Pajak</th><th>Bukti Potong</th><th>Tax status</th>
              </tr></thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtDate(b.created_at.slice(0, 10))}</td>
                    <td><button onClick={() => onOpen(b.id)} style={{ background: "none", border: "none", color: "var(--gold)", fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0 }}>{b.payout_no}</button></td>
                    <td>{b.vendor_name || "—"}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 240 }}>{b.store_name}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{rp(b.total)}</td>
                    {(["faktur", "bukpot"] as const).map((kind) => (
                      <td key={kind} style={{ whiteSpace: "nowrap" }}>
                        <FileCell batchId={b.id} kind={kind} name={fileNameOf(b, kind)} busy={busyKey === `${b.id}:${kind}`} onUpload={(f) => upload(b, kind, f)} onRemove={() => remove(b, kind)} />
                      </td>
                    ))}
                    <td><span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: TAX_COLOR[b.tax_status || ""] || "var(--muted)", border: `1px solid ${(TAX_COLOR[b.tax_status || ""] || "#888")}55`, background: `${(TAX_COLOR[b.tax_status || ""] || "#888")}18` }}>{b.tax_status || "—"}</span></td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{missingOnly ? "Every payout has both documents." : "No payouts yet."}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
