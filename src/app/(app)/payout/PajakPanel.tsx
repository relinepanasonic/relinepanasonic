"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Loader from "@/components/Loader";
import DateRangePicker from "@/components/DateRangePicker";
import { fmtDate } from "@/lib/dates";
import type { PayoutBatch } from "@/lib/payoutExport";
import { FILE_LABEL, FileCell, NoVendors, VendorBar, fileNameOf, removePayoutFile, rp, tabBtn, uploadPayoutFile, useVendors, type FileKind, type Supabase } from "./shared";

// Pajak (Super Admin + Admin). Rules used (Oct 2026):
//   PPN    12% x DPP nilai lain 11/12 (PMK 131/2024) = 11% effective. Harga Beli excludes PPN (payout total = DPP);
//          Shopee sales prices include PPN (DPP = price / 1.11).
//   PPh 22 collected by Shopee at 0.5% of gross turnover excl. PPN (PMK 37/2025), from 1 Oct 2026.
// Sub pages:
//   Rekap         per masa pajak: PPN Keluaran - PPN Masukan = PPN kurang / (lebih) bayar, and PPh 22 collected.
//   PPN Masukan   PPN on buying from vendors: one row per payout, created automatically (fill in the Nomor Faktur).
//   PPN Keluaran  PPN on the Shopee sales, automatic from Order Completed per store per month (Harga Jual incl. PPN:
//                 DPP = Harga Jual / 1.11, PPN = Harga Jual - DPP), plus typed-in rows.
//   PPh 22        PPh 22 collected by Shopee, typed in from Shopee's bukti pungut.
//   Dokumen       Faktur Pajak and Bukti Potong files per payout.
type Kind = "ppn_masukan" | "ppn_keluaran" | "pph22";
type TaxRow = {
  id: string; kind: Kind; period: string; tx_date: string | null; store_name: string | null; counterparty: string | null; doc_no: string | null;
  dpp: number; rate: number; amount: number; total: number; source: "manual" | "payout" | "order"; payout_no?: string | null; note: string | null;
};
const KIND_LABEL: Record<Kind, string> = { ppn_masukan: "PPN Masukan", ppn_keluaran: "PPN Keluaran", pph22: "PPh 22" };
const DEFAULT_RATE: Record<Kind, number> = { ppn_masukan: 0.11, ppn_keluaran: 0.11, pph22: 0.005 };
const masa = (p: string) => { const d = new Date(p + "T00:00:00"); return d.toLocaleDateString("id-ID", { month: "short", year: "numeric" }); };
const pct = (r: number) => `${(Number(r) * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

export default function PajakPanel({ supabase, clientId, onOpen }: { supabase: Supabase; clientId: string; onOpen: (batchId: string) => void }) {
  const [tab, setTab] = useState<"rekap" | Kind | "docs">("rekap");
  return (
    <div className="panel">
      <h3>Pajak</h3>
      <div className="hint">PPN 12% × DPP 11/12 (11% effective, PMK 131/2024) · PPh 22 marketplace 0.5% collected by Shopee from 1 Oct 2026 (PMK 37/2025)</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 14px" }}>
        {([["rekap", "Rekap"], ["ppn_masukan", "PPN Masukan"], ["ppn_keluaran", "PPN Keluaran"], ["pph22", "PPh 22"], ["docs", "Dokumen"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={tabBtn(tab === k)}>{l}</button>
        ))}
      </div>
      {tab === "rekap" && <Rekap supabase={supabase} clientId={clientId} />}
      {(tab === "ppn_masukan" || tab === "ppn_keluaran" || tab === "pph22") && <TaxTable key={tab} supabase={supabase} clientId={clientId} kind={tab} onOpen={onOpen} />}
      {tab === "docs" && <Docs supabase={supabase} clientId={clientId} onOpen={onOpen} />}
    </div>
  );
}

/* ── Rekap per masa pajak ── */
type Sum = { period: string; keluaran: number; masukan: number; ppn_net: number; pph22: number; dpp_keluaran: number; dpp_masukan: number; omzet_pph22: number };
function Rekap({ supabase, clientId }: { supabase: Supabase; clientId: string }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Sum[] | null>(null);
  useEffect(() => {
    if (!clientId) return;
    (async () => {
       
      setRows(null);
      const { data } = await supabase.rpc("tax_summary", { p_client_id: clientId, p_year: year });
      setRows((data as Sum[]) || []);
    })();
  }, [supabase, clientId, year]);
  const tot = (k: keyof Sum) => (rows || []).reduce((a, r) => a + Number(r[k] || 0), 0);
  const net = (n: number) => <span style={{ color: n > 0 ? "#f87171" : n < 0 ? "#86efac" : undefined, fontWeight: 700 }}>{n < 0 ? `(${rp(-n)})` : rp(n)}</span>;
  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
        <div className="fld" style={{ minWidth: 120 }}><label>Tahun</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", paddingBottom: 10 }}>PPN kurang bayar in red, lebih bayar (in brackets) in green.</div>
      </div>
      {rows === null ? <Loader center /> : (
        <div className="tbl-wrap">
          <table className="tbl day-tbl">
            <thead><tr>
              <th>Masa Pajak</th><th className="num">DPP Keluaran</th><th className="num">PPN Keluaran</th><th className="num">DPP Masukan</th><th className="num">PPN Masukan</th>
              <th className="num">PPN Kurang / (Lebih) Bayar</th><th className="num">Omzet (PPh 22)</th><th className="num">PPh 22 Dipungut</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period}>
                  <td style={{ fontWeight: 700 }}>{masa(r.period)}</td>
                  <td className="num">{rp(r.dpp_keluaran)}</td><td className="num">{rp(r.keluaran)}</td>
                  <td className="num">{rp(r.dpp_masukan)}</td><td className="num">{rp(r.masukan)}</td>
                  <td className="num">{net(Number(r.ppn_net))}</td>
                  <td className="num">{rp(r.omzet_pph22)}</td><td className="num">{rp(r.pph22)}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr style={{ fontWeight: 800, borderTop: "2px solid rgba(201,162,39,.4)" }}>
                  <td>TOTAL {year}</td><td className="num">{rp(tot("dpp_keluaran"))}</td><td className="num">{rp(tot("keluaran"))}</td>
                  <td className="num">{rp(tot("dpp_masukan"))}</td><td className="num">{rp(tot("masukan"))}</td><td className="num">{net(tot("ppn_net"))}</td>
                  <td className="num">{rp(tot("omzet_pph22"))}</td><td className="num">{rp(tot("pph22"))}</td>
                </tr>
              )}
              {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No tax rows in {year} yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ── one tax table (PPN Masukan / PPN Keluaran / PPh 22) ── */
function TaxTable({ supabase, clientId, kind, onOpen }: { supabase: Supabase; clientId: string; kind: Kind; onOpen: (batchId: string) => void }) {
  const v = useVendors(supabase, clientId);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<TaxRow[] | null>(null);
  const [edit, setEdit] = useState<Partial<TaxRow> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setRows(null);
    const { data, error } = await supabase.rpc("tax_list", { p_client_id: clientId, p_kind: kind, p_from: from || null, p_to: to || null });
    if (error) setMsg({ ok: false, text: error.message });
    setRows(error ? [] : ((data as TaxRow[]) || []));
  }, [supabase, clientId, kind, from, to]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function del(r: TaxRow) {
    if (!window.confirm(`Delete this ${KIND_LABEL[kind]} row (${rp(r.amount)})?`)) return;
    const { error } = await supabase.rpc("tax_delete", { p_id: r.id });
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "Row deleted." }); load();
  }

  const sum = (k: "dpp" | "amount" | "total") => (rows || []).reduce((a, r) => a + Number(r[k] || 0), 0);
  const stores = useMemo(() => v.stores.map((s) => s.store_name), [v.stores]);

  return (
    <>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div className="fld"><label>Masa pajak</label><DateRangePicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} placeholder="All periods" /></div>
        <button className="btn-gold" onClick={() => setEdit({ kind, rate: DEFAULT_RATE[kind], tx_date: new Date().toISOString().slice(0, 10), counterparty: kind === "pph22" ? "Shopee" : kind === "ppn_keluaran" ? "Shopee buyers" : "" })} style={{ padding: "10px 22px" }}>+ Add {KIND_LABEL[kind]}</button>
      </div>
      {kind === "ppn_masukan" && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>Every Pay to Vendor adds its PPN Masukan here automatically: DPP = the payout total (Harga Beli excludes PPN), PPN 11% on top. Open a row to fill in the Nomor Faktur Pajak.</div>}
      {kind === "ppn_keluaran" && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>Automatic from Order Completed: per store per month (completed date), Harga Jual = Subtotal Pesanan minus returns, incl. PPN → DPP = Harga Jual ÷ 1.11, PPN = Harga Jual − DPP. Always up to date after each upload; typed-in rows are added to it.</div>}
      {kind === "pph22" && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>Type in each bukti pungut from Shopee: DPP = gross turnover (excl. PPN), PPh 22 = 0.5%. It can be credited against your income tax.</div>}
      {v.vendors && v.vendors.length === 0 && kind === "ppn_masukan" && <NoVendors />}
      {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", marginBottom: 10, fontSize: 13 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}
      {rows === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "60vh" }}>
          <table className="tbl day-tbl">
            <thead><tr>
              <th>Masa</th><th>Tanggal</th><th>Store</th><th>{kind === "ppn_masukan" ? "Vendor" : kind === "pph22" ? "Pemungut" : "Pembeli"}</th>
              <th>{kind === "pph22" ? "No. Bukti Pungut" : "No. Faktur Pajak"}</th>
              <th className="num">{kind === "pph22" ? "DPP (Omzet)" : "DPP"}</th><th className="num">Tarif</th><th className="num">{KIND_LABEL[kind]}</th>
              {kind !== "pph22" && <th className="num">Total (incl. PPN)</th>}<th>Sumber</th><th>Keterangan</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id || `auto-${r.period}-${r.store_name}`}>
                  <td style={{ fontWeight: 700 }}>{masa(r.period)}</td>
                  <td>{r.tx_date ? fmtDate(r.tx_date) : "—"}</td>
                  <td style={{ whiteSpace: "normal", maxWidth: 200 }}>{r.store_name || "—"}</td>
                  <td>{r.counterparty || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12.5, color: r.doc_no ? undefined : "#fbbf24" }}>{r.doc_no || (r.source === "payout" ? "fill in" : "—")}</td>
                  <td className="num">{rp(r.dpp)}</td><td className="num">{pct(r.rate)}</td><td className="num" style={{ fontWeight: 700 }}>{rp(r.amount)}</td>
                  {kind !== "pph22" && <td className="num">{rp(r.total)}</td>}
                  <td style={{ fontSize: 12.5 }}>
                    {r.source === "payout" && r.payout_no ? <span style={{ color: "var(--gold)" }}>Payout {r.payout_no}</span> : r.source === "order" ? "Order Completed" : "Manual"}
                  </td>
                  <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }} title={r.note || ""}>{r.note || ""}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.source !== "order" && <button className="btn-ghost" onClick={() => setEdit(r)}>Edit</button>}{" "}
                    {r.source === "manual" && <button className="btn-ghost" onClick={() => del(r)} style={{ color: "#f87171" }}>Delete</button>}
                  </td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr style={{ fontWeight: 800, borderTop: "2px solid rgba(201,162,39,.4)" }}>
                  <td colSpan={5}>TOTAL</td><td className="num">{rp(sum("dpp"))}</td><td></td><td className="num" style={{ color: "var(--gold)" }}>{rp(sum("amount"))}</td>
                  {kind !== "pph22" && <td className="num">{rp(sum("total"))}</td>}<td colSpan={3}></td>
                </tr>
              )}
              {rows.length === 0 && <tr><td colSpan={12} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No {KIND_LABEL[kind]} rows yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {edit && <EditTax supabase={supabase} clientId={clientId} kind={kind} row={edit} stores={stores} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setMsg({ ok: true, text: "Saved." }); load(); }} onOpen={onOpen} />}
    </>
  );
}

function EditTax({ supabase, clientId, kind, row, stores, onClose, onSaved, onOpen }: {
  supabase: Supabase; clientId: string; kind: Kind; row: Partial<TaxRow>; stores: string[]; onClose: () => void; onSaved: () => void; onOpen: (batchId: string) => void;
}) {
  const locked = row.source === "payout";   // amounts follow the payout
  const [f, setF] = useState({
    tx_date: row.tx_date || "", store_name: row.store_name || "", counterparty: row.counterparty || "", doc_no: row.doc_no || "",
    dpp: String(Math.round(Number(row.dpp || 0)) || ""), rate: String(Number(row.rate ?? DEFAULT_RATE[kind]) * 100), amount: String(Math.round(Number(row.amount || 0)) || ""),
    note: row.note || "",
  });
  const [amountTouched, setAmountTouched] = useState(Boolean(row.id));
  const [err, setErr] = useState("");
  const dpp = Number(f.dpp.replace(/[^0-9.-]/g, "")) || 0;
  const rate = (Number(f.rate) || 0) / 100;
  const autoAmount = Math.round(dpp * rate);
  const amount = amountTouched ? Number(f.amount.replace(/[^0-9.-]/g, "")) || 0 : autoAmount;
  const total = kind === "pph22" ? dpp : dpp + amount;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    if (!locked && !f.tx_date) return setErr("Pick the date");
    const { error } = await supabase.rpc("tax_upsert", { p_client_id: clientId, p_row: {
      id: row.id || null, kind, tx_date: f.tx_date || null, store_name: f.store_name, counterparty: f.counterparty, doc_no: f.doc_no,
      dpp, rate, amount, total, note: f.note,
    } });
    if (error) return setErr(error.message);
    onSaved();
  }

  const inp: React.CSSProperties = { width: "100%" };
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(4,9,20,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(94vw, 620px)", background: "var(--card,#0d1a36)", border: "1px solid rgba(201,162,39,.3)", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: "#fff", marginBottom: 4 }}>{row.id ? "Edit" : "Add"} {KIND_LABEL[kind]}</div>
        {locked && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
          From payout <button onClick={() => { const id = (row as { payout_id?: string }).payout_id; if (id) onOpen(id); }} style={{ background: "none", border: "none", color: "var(--gold)", textDecoration: "underline", cursor: "pointer", padding: 0 }}>{row.payout_no}</button> — the amounts follow the payout; fill in the Nomor Faktur and a note.
        </div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div className="fld"><label>Tanggal</label><input type="date" value={f.tx_date} onChange={set("tx_date")} disabled={locked} style={{ ...inp, colorScheme: "dark" }} /></div>
          <div className="fld"><label>Store</label>
            <select value={f.store_name} onChange={set("store_name")} disabled={locked} style={inp}>
              <option value="">—</option>{stores.map((s) => <option key={s} value={s}>{s}</option>)}
              {f.store_name && !stores.includes(f.store_name) && <option value={f.store_name}>{f.store_name}</option>}
            </select>
          </div>
          <div className="fld"><label>{kind === "ppn_masukan" ? "Vendor" : kind === "pph22" ? "Pemungut" : "Pembeli"}</label><input value={f.counterparty} onChange={set("counterparty")} disabled={locked} style={inp} /></div>
          <div className="fld"><label>{kind === "pph22" ? "No. Bukti Pungut" : "No. Faktur Pajak"}</label><input value={f.doc_no} onChange={set("doc_no")} placeholder={kind === "pph22" ? "" : "010.000-26.00000000"} style={inp} /></div>
          <div className="fld"><label>{kind === "pph22" ? "DPP (Omzet, excl. PPN)" : "DPP"}</label><input inputMode="numeric" value={f.dpp} onChange={set("dpp")} disabled={locked} style={inp} /></div>
          <div className="fld"><label>Tarif (%)</label><input inputMode="decimal" value={f.rate} onChange={set("rate")} disabled={locked} style={inp} /></div>
          <div className="fld"><label>{KIND_LABEL[kind]} {amountTouched ? "" : "(auto)"}</label>
            <input inputMode="numeric" value={amountTouched ? f.amount : String(autoAmount)} onChange={(e) => { setAmountTouched(true); setF((x) => ({ ...x, amount: e.target.value })); }} disabled={locked} style={inp} />
          </div>
          <div className="fld"><label>{kind === "pph22" ? "Omzet" : "Total (incl. PPN)"}</label><input value={rp(total)} disabled style={inp} /></div>
          <div className="fld" style={{ gridColumn: "1 / -1" }}><label>Keterangan</label><input value={f.note} onChange={set("note")} style={inp} /></div>
        </div>
        {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-gold" onClick={save} style={{ padding: "10px 28px" }}>Save</button>
        </div>
      </div>
    </div>, document.body);
}

/* ── Dokumen: Faktur Pajak and Bukti Potong files per payout ── */
const TAX_COLOR: Record<string, string> = { Complete: "#86efac", "Missing both": "#f87171", "Faktur Pajak missing": "#fbbf24", "Bukti Potong missing": "#fbbf24" };
function Docs({ supabase, clientId, onOpen }: { supabase: Supabase; clientId: string; onOpen: (batchId: string) => void }) {
  const v = useVendors(supabase, clientId);
  const [list, setList] = useState<PayoutBatch[] | null>(null);
  const [missingOnly, setMissingOnly] = useState(false);
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
  const shown = (list || []).filter((b) => !missingOnly || b.tax_status !== "Complete");

  return (
    <>
      <VendorBar v={v}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#cdd9f0", paddingBottom: 10 }}>
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing only
        </label>
      </VendorBar>
      {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", marginBottom: 10, fontSize: 13 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}
      {list === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "60vh" }}>
          <table className="tbl day-tbl">
            <thead><tr>
              <th>Date Payout</th><th>No Payout</th><th>Vendor</th><th>Store name</th><th className="num">Total Payout</th>
              <th>Faktur Pajak</th><th>Bukti Potong</th><th>Status</th>
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
      )}
    </>
  );
}
