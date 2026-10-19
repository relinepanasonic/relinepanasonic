"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { fmtDate } from "@/lib/dates";
import { parseProductList } from "@/lib/parseProductList";
import { FileCell, NoVendors, VendorBar, removePayoutFile, rp, tabBtn, uploadPayoutFile, useVendors } from "./shared";

// Harga Beli: the purchase price per VENDOR (all its stores), per product and variant, with a history.
//   Prices    - Prod ID | Prod Name | Variant ID | Variant Name | Harga Beli | PPN | Since. "New Price" first asks when the new
//               prices become active, then every price can be edited; the current price is filled in as the baseline,
//               so only the prices you actually change are saved. An order uses the price in force on its ORDER CREATED
//               date; a variant without its own price uses the product price.
//   Price Log - one entry per New Price save: Log ID | Date Price Created | Date Price Active | Vendor | Created by | Proof | Status;
//               press an entry to see its prices (before -> after).
const PAGE = 200;

type Row = {
  kode_produk: string; nama_produk: string | null; kode_variasi: string; nama_variasi: string | null;
  price: number; has_price: boolean; inherited: boolean; since: string | null;
};
type LogEntry = {
  id: number; created_at: string; effective_from: string; vendor_name: string | null; created_by_name: string | null;
  items: number; note: string | null; proof_name: string | null; status: "Scheduled" | "Active";
};
type LogLine = { kode_produk: string; kode_variasi: string; nama_produk: string | null; nama_variasi: string | null; old_price: number | null; new_price: number; stores: string };
const rowKey = (r: Pick<Row, "kode_produk" | "kode_variasi">) => `${r.kode_produk}::${r.kode_variasi}`;
const digits = (v: string) => v.replace(/[^0-9]/g, "");
const fmtDigits = (d: string) => (d ? Number(d).toLocaleString("id-ID") : "");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const ppn = (n: number) => Math.round(n - n / 1.11);
const baselineOf = (r: Row) => (r.price ? String(Math.round(r.price)) : "");   // what the input starts with
const STATUS_COLOR: Record<string, string> = { Scheduled: "#60a5fa", Active: "#86efac" };

export default function HargaBeli({ clientId }: { clientId: string }) {
  const [supabase] = useState(() => createClient());
  const ven = useVendors(supabase, clientId);
  // prices are kept per store; a vendor's stores always share them, so the first store stands for the vendor when reading
  const repStore = ven.vendor?.stores[0] || "";
  const [view, setView] = useState<"prices" | "log">("prices");
  const [isAdmin, setIsAdmin] = useState(false);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");                     // debounced search
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [editFrom, setEditFrom] = useState<string | null>(null);        // New Price mode: the date the prices become active
  const [edits, setEdits] = useState<Map<string, { value: string; base: string }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dialog, setDialog] = useState<null | "new" | "all">(null);
  const [since, setSince] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [openLog, setOpenLog] = useState<LogEntry | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setIsAdmin(["superadmin", "client_admin"].includes((p as { role?: string } | null)?.role || ""));
    })();
  }, [supabase]);

  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(0); }, 350); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async () => {
    if (!clientId || !repStore) { setRows(null); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc("harga_beli_list", {
      p_client_id: clientId, p_store: repStore, p_search: q || null, p_only_missing: onlyMissing,
      p_limit: PAGE, p_offset: page * PAGE,
    });
    if (error) { setMsg({ ok: false, text: error.message }); setRows([]); setTotal(0); }
    else { const d = data as { total: number; rows: Row[] }; setRows(d.rows || []); setTotal(d.total || 0); }
    setLoading(false);
  }, [supabase, clientId, repStore, q, onlyMissing, page]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (view === "prices") load(); }, [load, view]);

  const loadLog = useCallback(async () => {
    if (!clientId) return;
    setLog(null);
    const { data, error } = await supabase.rpc("price_change_list", { p_client_id: clientId, p_vendor: ven.vendorId || null });
    if (error) setMsg({ ok: false, text: error.message });
    setLog(error ? [] : ((data as LogEntry[]) || []));
  }, [supabase, clientId, ven.vendorId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (view === "log") loadLog(); }, [loadLog, view]);

  // only the prices that differ from their baseline are saved
  const changes = useMemo(() => {
    const out: { kode_produk: string; kode_variasi: string; harga_beli: number }[] = [];
    edits.forEach((e, k) => {
      if (e.value === "" || e.value === e.base) return;
      const [kode_produk, kode_variasi] = k.split("::");
      out.push({ kode_produk, kode_variasi, harga_beli: Number(e.value) });
    });
    return out;
  }, [edits]);

  function startNew() { setSince(todayISO()); setDialog("new"); }
  function cancelNew() { setEditFrom(null); setEdits(new Map()); }

  async function save() {
    if (!changes.length || !ven.vendorId || !editFrom) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("harga_beli_save_vendor", { p_client_id: clientId, p_vendor: ven.vendorId, p_since: editFrom, p_items: changes });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message.replace(/^FORBIDDEN:\s*/, "") }); return; }
    const r = data as { saved: number; stores: number; log_id: number | null };
    setMsg({ ok: true, text: `${r.saved} new price${r.saved === 1 ? "" : "s"} for ${ven.vendor?.name}, active from ${fmtDate(editFrom)}${r.log_id ? ` · Log #${r.log_id}` : ""}.` });
    cancelNew(); load();
  }

  async function applyAll() {
    if (!ven.vendorId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("harga_beli_apply_all_vendor", { p_client_id: clientId, p_vendor: ven.vendorId, p_since: since });
    setBusy(false); setDialog(null);
    if (error) { setMsg({ ok: false, text: error.message.replace(/^FORBIDDEN:\s*/, "") }); return; }
    const r = data as { prices: number; dealers: number; log_id: number | null };
    setMsg({ ok: true, text: r.prices ? `${ven.vendor?.name}'s prices copied to ${r.dealers} other store${r.dealers === 1 ? "" : "s"} (${r.prices} prices), active from ${fmtDate(since)}${r.log_id ? ` · Log #${r.log_id}` : ""}.` : "Every store already has these prices." });
  }

  async function uploadList(file: File) {
    setBusy(true); setMsg(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
      const parsed = parseProductList(matrix);
      if (!parsed.rows.length) { setMsg({ ok: false, text: "No products found. Is this the SPOS file (columns Kode Produk, Produk, Kode Variasi, Nama Variasi)?" }); setBusy(false); return; }
      const res = await fetch("/api/harga-beli/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, rows: parsed.rows }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: j.error || `Upload failed (${res.status})` });
      else setMsg({ ok: true, text: `Product list updated: ${parsed.rows.length} products / variants read, ${j.added} new.${parsed.lossy ? ` ⚠ ${parsed.lossy} IDs look cut short ("E+11"): export the SPOS file as xlsx instead of csv.` : ""}` });
      load();
    } catch (e) { setMsg({ ok: false, text: String(e) }); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function proofUpload(l: LogEntry, f: File) {
    setBusyKey(String(l.id)); setMsg(null);
    try { await uploadPayoutFile(supabase, String(l.id), "proof", f, "price"); setMsg({ ok: true, text: `Proof saved for Log #${l.id}.` }); loadLog(); }
    catch (e) { setMsg({ ok: false, text: String((e as Error).message || e) }); }
    setBusyKey("");
  }
  async function proofRemove(l: LogEntry) {
    if (!window.confirm(`Remove the proof of Log #${l.id}?`)) return;
    try { await removePayoutFile(String(l.id), "proof", "price"); setMsg({ ok: true, text: `Proof of Log #${l.id} removed.` }); }
    catch (e) { setMsg({ ok: false, text: String((e as Error).message || e) }); }
    loadLog();
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const inputStyle = (dirty: boolean): React.CSSProperties => ({
    width: 150, textAlign: "right", padding: "8px 10px", borderRadius: 8, fontSize: 14, color: "#fff",
    background: "rgba(7,13,26,.85)", border: `1px solid ${dirty ? "var(--gold)" : "rgba(201,162,39,.35)"}`, outline: "none",
  });

  return (
    <div className="panel">
      <h3>Harga Beli</h3>
      <div className="hint">Purchase price per vendor (all its stores) · a new price counts for orders created from its active date</div>
      <div style={{ display: "flex", gap: 8, margin: "10px 0 12px" }}>
        <button style={tabBtn(view === "prices")} onClick={() => setView("prices")}>Prices</button>
        <button style={tabBtn(view === "log")} onClick={() => setView("log")}>Price Log</button>
      </div>

      <VendorBar v={ven} showStores={false}>
        {view === "prices" && (
          <>
            <div className="fld" style={{ minWidth: 240, flex: 1 }}>
              <label>Search</label>
              <input type="text" placeholder="Product ID / Product / Variant ID / Variant" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#cdd9f0", paddingBottom: 10 }}>
              <input type="checkbox" checked={onlyMissing} onChange={(e) => { setOnlyMissing(e.target.checked); setPage(0); }} /> Only without price
            </label>
            {isAdmin && !editFrom && (
              <>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadList(f); }} />
                <button className="btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>⬆ Upload product list (SPOS)</button>
                <button className="btn-ghost" disabled={busy || !repStore} onClick={() => { setSince(todayISO()); setDialog("all"); }}>Use for all vendors</button>
              </>
            )}
            {!editFrom && <button className="btn-gold" disabled={!repStore} onClick={startNew} style={{ padding: "11px 26px" }}>+ New Price</button>}
          </>
        )}
      </VendorBar>

      {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", marginBottom: 10, fontSize: 13 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}

      {view === "prices" ? (
        ven.vendors && ven.vendors.length === 0 ? <NoVendors />
        : !ven.vendorId ? <div style={{ textAlign: "center", color: "var(--muted)", padding: 30 }}>Pick a vendor to see and set its prices.</div>
        : !repStore ? <div style={{ textAlign: "center", color: "#fbbf24", padding: 30 }}>This vendor has no store yet — add its stores in Core List → Vendors.</div>
        : loading || rows === null ? <Loader center /> : (
          <>
            {editFrom && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid rgba(201,162,39,.5)", background: "rgba(201,162,39,.08)", borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
                <div style={{ flex: 1, minWidth: 240, fontSize: 13.5 }}>
                  <b style={{ color: "var(--gold)" }}>New Price</b> · active from <b style={{ color: "#fff" }}>{fmtDate(editFrom)}</b> · the current price is filled in — change only the prices that are different
                </div>
                <span style={{ fontSize: 13, color: "var(--gold)" }}>{changes.length} change{changes.length === 1 ? "" : "s"}</span>
                <button className="btn-ghost" onClick={() => { setSince(editFrom); setDialog("new"); }}>Change date</button>
                <button className="btn-ghost" onClick={cancelNew}>Cancel</button>
                <button className="btn-gold" disabled={busy || !changes.length} onClick={save} style={{ padding: "9px 26px" }}>{busy ? "Saving…" : "Save"}</button>
              </div>
            )}
            <div className="tbl-wrap" style={{ maxHeight: "60vh" }}>
              <table className="tbl day-tbl">
                <thead><tr>
                  <th>Prod ID</th><th>Prod Name</th><th>Variant ID</th><th>Variant Name</th>
                  <th className="num" style={{ minWidth: editFrom ? 190 : undefined }}>{editFrom ? "New price" : "Harga Beli"}</th>
                  <th className="num" title="PPN inside the price (incl. PPN: price ÷ 1.11 = DPP)">PPN (11%)</th><th>Since</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const k = rowKey(r);
                    const e = edits.get(k);
                    const base = baselineOf(r);
                    const value = e ? e.value : base;
                    const dirty = !!e && e.value !== "" && e.value !== e.base;
                    const shown = Number(value || 0);
                    return (
                      <tr key={k} style={dirty ? { background: "rgba(201,162,39,.10)" } : undefined}>
                        <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.kode_produk}</td>
                        <td style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis" }} title={r.nama_produk || ""}>{r.nama_produk || "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.kode_variasi}</td>
                        <td>{r.nama_variasi || "-"}</td>
                        <td className="num">
                          {editFrom ? (
                            <>
                              <input inputMode="numeric" value={fmtDigits(value)} placeholder="Rp"
                                onChange={(ev) => { const d = digits(ev.target.value); setEdits((m) => { const n = new Map(m); n.set(k, { value: d, base }); return n; }); }}
                                style={inputStyle(dirty)} />
                              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                                {r.price ? `now ${rp(r.price)}${r.inherited ? " (product price)" : ""}` : "no price yet"}{dirty ? " · changed" : ""}
                              </div>
                            </>
                          ) : (
                            <span style={{ color: r.price ? "#e8edf8" : "var(--muted)" }}>
                              {r.price ? rp(r.price) : "—"}{r.inherited && <span style={{ fontSize: 10.5, color: "var(--muted)" }}> (product price)</span>}
                            </span>
                          )}
                        </td>
                        <td className="num" style={{ color: "var(--muted)" }}>{shown ? rp(ppn(shown)) : "—"}</td>
                        <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{r.since ? fmtDate(r.since) : "—"}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                      {total === 0 && !q && !onlyMissing ? "No products yet. Upload the product list (SPOS file) first." : "Nothing matches."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12 }}>
              {total.toLocaleString("id-ID")} products / variants · page {page + 1} of {pages}{" "}
              <button className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>{" "}
              <button className="btn-ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
              {editFrom && changes.length > 0 && <span style={{ marginLeft: 10 }}>· your changes stay when you change page</span>}
            </div>
          </>
        )
      ) : log === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
          <table className="tbl day-tbl">
            <thead><tr>
              <th>Log ID</th><th>Date Price Created</th><th>Date Price Active</th><th>Vendor</th><th>Created by</th>
              <th className="num">Prices</th><th>Proof</th><th>Status</th>
            </tr></thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id} style={{ cursor: "pointer" }} onClick={() => setOpenLog(l)}>
                  <td style={{ fontWeight: 700, color: "var(--gold)" }}>#{l.id}</td>
                  <td style={{ fontSize: 12.5 }}>{fmtDate(l.created_at.slice(0, 10))} {l.created_at.slice(11, 16)}</td>
                  <td>{fmtDate(l.effective_from)}</td>
                  <td title={l.note || ""}>{l.vendor_name || "—"}</td>
                  <td>{l.created_by_name || "—"}</td>
                  <td className="num">{l.items}</td>
                  <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                    <FileCell batchId={String(l.id)} kind="proof" target="price" label="Upload proof" name={l.proof_name} busy={busyKey === String(l.id)}
                      onUpload={(f) => proofUpload(l, f)} onRemove={() => proofRemove(l)} />
                  </td>
                  <td><span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: STATUS_COLOR[l.status], border: `1px solid ${STATUS_COLOR[l.status]}55`, background: `${STATUS_COLOR[l.status]}18` }}>{l.status}</span></td>
                </tr>
              ))}
              {log.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No price updates yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {openLog && <LogView supabase={supabase} entry={openLog} onClose={() => setOpenLog(null)} />}

      {dialog && typeof document !== "undefined" && createPortal(
        <div onClick={() => !busy && setDialog(null)} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(4,9,20,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(94vw, 460px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.3))", borderRadius: 18, padding: 26, boxShadow: "0 30px 80px rgba(0,0,0,.7)" }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#fff", marginBottom: 6 }}>{dialog === "new" ? "When is the new price active?" : "Use these prices for all vendors?"}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
              {dialog === "new"
                ? <>New prices for <b style={{ color: "#fff" }}>{ven.vendor?.name}</b> ({ven.vendor?.stores.length} store{ven.vendor?.stores.length === 1 ? "" : "s"}). Orders <b>created</b> on or after this date use the new price; earlier orders keep the old one.</>
                : <>Every price of <b style={{ color: "#fff" }}>{ven.vendor?.name}</b> is copied to all other vendors&apos; stores from this date. Their own prices for these products are replaced from that date on (the history stays in the Price Log).</>}
            </div>
            <div className="fld"><label>Active from</label><input type="date" value={since} onChange={(e) => setSince(e.target.value)} style={{ colorScheme: "dark" }} /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button className="btn-ghost" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
              <button className="btn-gold" disabled={busy || !since}
                onClick={() => { if (dialog === "new") { setEditFrom(since); setDialog(null); } else applyAll(); }}
                style={{ padding: "10px 28px" }}>{busy ? "Saving…" : dialog === "new" ? "Continue" : "Copy to all vendors"}</button>
            </div>
          </div>
        </div>, document.body)}
    </div>
  );
}

// the prices of one Price Log entry
function LogView({ supabase, entry, onClose }: { supabase: ReturnType<typeof createClient>; entry: LogEntry; onClose: () => void }) {
  const [lines, setLines] = useState<LogLine[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("price_change_lines", { p_change_id: entry.id });
      setLines((data as LogLine[]) || []);
    })();
  }, [supabase, entry.id]);
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(4,9,20,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(96vw, 1100px)", maxHeight: "90vh", overflow: "auto", background: "var(--card,#0d1a36)", border: "1px solid rgba(201,162,39,.3)", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>Log #{entry.id} · {entry.vendor_name || "—"}</div>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
          Created {fmtDate(entry.created_at.slice(0, 10))} {entry.created_at.slice(11, 16)} by {entry.created_by_name || "—"} · active from {fmtDate(entry.effective_from)} · {entry.status}{entry.note ? ` · ${entry.note}` : ""}
        </div>
        {lines === null ? <Loader center /> : (
          <div className="tbl-wrap" style={{ maxHeight: "65vh" }}>
            <table className="tbl day-tbl">
              <thead><tr><th>Prod ID</th><th>Product</th><th>Variant</th><th>Stores</th><th className="num">Price before</th><th className="num">New price</th><th className="num">PPN (11%)</th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{l.kode_produk}</td>
                    <td style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis" }} title={l.nama_produk || ""}>{l.nama_produk || "—"}</td>
                    <td>{l.kode_variasi === "-" ? "—" : (l.nama_variasi || l.kode_variasi)}</td>
                    <td style={{ fontSize: 12.5 }}>{l.stores}</td>
                    <td className="num" style={{ color: "var(--muted)" }}>{l.old_price == null ? "—" : rp(l.old_price)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{rp(l.new_price)}</td>
                    <td className="num" style={{ color: "var(--muted)" }}>{rp(ppn(Number(l.new_price)))}</td>
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No prices in this entry.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>, document.body);
}
