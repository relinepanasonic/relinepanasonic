"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { fmtDate } from "@/lib/dates";
import { parseProductList } from "@/lib/parseProductList";
import { NoVendors, VendorBar, rp, tabBtn, useVendors } from "./shared";

// Harga Beli: the purchase price per VENDOR (all its stores), per product and variant, with a history.
//   Prices   - Prod ID | Prod Name | Variant ID | Variant Name | Price before | New price. Saving asks "since which date";
//              an order uses the price in force on its ORDER CREATED date. A variant without its own price uses the
//              product price. Admin can copy one dealer's prices to every dealer, and upload the product list (SPOS).
//   Price Log - every saved price: the price before, the new price, the start date, who and when.
const PAGE = 200;

type Row = {
  kode_produk: string; nama_produk: string | null; kode_variasi: string; nama_variasi: string | null;
  price: number; has_price: boolean; inherited: boolean; since: string | null;
};
type LogRow = {
  created_at: string; vendor_name: string | null; stores: string; kode_produk: string; nama_produk: string | null;
  kode_variasi: string; nama_variasi: string | null; old_price: number | null; new_price: number; effective_from: string;
  source: string; created_by_name: string | null;
};
const rowKey = (r: Pick<Row, "kode_produk" | "kode_variasi">) => `${r.kode_produk}::${r.kode_variasi}`;
const digits = (v: string) => v.replace(/[^0-9]/g, "");
const fmtDigits = (d: string) => (d ? Number(d).toLocaleString("id-ID") : "");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

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
  const [edits, setEdits] = useState<Map<string, string>>(new Map());   // rowKey -> digits typed
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dialog, setDialog] = useState<null | "save" | "all">(null);
  const [since, setSince] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogRow[] | null>(null);
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
    const { data } = await supabase.rpc("harga_beli_log_vendor", { p_client_id: clientId, p_vendor: ven.vendorId || null, p_search: q || null, p_limit: 500 });
    setLog((data as LogRow[]) || []);
  }, [supabase, clientId, ven.vendorId, q]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (view === "log") loadLog(); }, [loadLog, view]);

  // a typed price counts as a change only when it differs from the price shown
  const changes = useMemo(() => {
    const out: { kode_produk: string; kode_variasi: string; harga_beli: number }[] = [];
    for (const r of rows || []) {
      const d = edits.get(rowKey(r));
      if (d === undefined || d === "") continue;
      if (!(r.has_price && Number(d) === Number(r.price))) out.push({ kode_produk: r.kode_produk, kode_variasi: r.kode_variasi, harga_beli: Number(d) });
    }
    return out;
  }, [rows, edits]);

  async function save() {
    if (!changes.length || !ven.vendorId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("harga_beli_save_vendor", { p_client_id: clientId, p_vendor: ven.vendorId, p_since: since, p_items: changes });
    setBusy(false); setDialog(null);
    if (error) { setMsg({ ok: false, text: error.message.replace(/^FORBIDDEN:\s*/, "") }); return; }
    const r = data as { saved: number; unchanged: number; stores: number };
    setMsg({ ok: true, text: `${r.saved} price${r.saved === 1 ? "" : "s"} saved for ${ven.vendor?.name} (${r.stores} store${r.stores === 1 ? "" : "s"}), valid from ${fmtDate(since)}.` });
    setEdits(new Map()); load();
  }

  async function applyAll() {
    if (!repStore) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("harga_beli_apply_all", { p_client_id: clientId, p_from_store: repStore, p_since: since });
    setBusy(false); setDialog(null);
    if (error) { setMsg({ ok: false, text: error.message.replace(/^FORBIDDEN:\s*/, "") }); return; }
    const r = data as { prices: number; dealers: number };
    setMsg({ ok: true, text: r.prices ? `${ven.vendor?.name}'s prices copied to ${r.dealers} other store${r.dealers === 1 ? "" : "s"} (${r.prices} prices), valid from ${fmtDate(since)}.` : "Every store already has these prices." });
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

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="panel">
      <h3>Harga Beli</h3>
      <div className="hint">Purchase price per vendor (all its stores) · a new price counts for orders created from its start date</div>
      <div style={{ display: "flex", gap: 8, margin: "10px 0 12px" }}>
        <button style={tabBtn(view === "prices")} onClick={() => setView("prices")}>Prices</button>
        <button style={tabBtn(view === "log")} onClick={() => setView("log")}>Price Log</button>
      </div>

      <VendorBar v={ven}>
        <div className="fld" style={{ minWidth: 240, flex: 1 }}>
          <label>Search</label>
          <input type="text" placeholder="Product ID / Product / Variant ID / Variant" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {view === "prices" && (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#cdd9f0", paddingBottom: 10 }}>
              <input type="checkbox" checked={onlyMissing} onChange={(e) => { setOnlyMissing(e.target.checked); setPage(0); }} /> Only without price
            </label>
            {isAdmin && (
              <>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadList(f); }} />
                <button className="btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>⬆ Upload product list (SPOS)</button>
                <button className="btn-ghost" disabled={busy || !repStore} onClick={() => { setSince(todayISO()); setDialog("all"); }}>Use for all vendors</button>
              </>
            )}
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
            <div className="tbl-wrap" style={{ maxHeight: "60vh" }}>
              <table className="tbl day-tbl">
                <thead><tr>
                  <th>Prod ID</th><th>Prod Name</th><th>Variant ID</th><th>Variant Name</th>
                  <th className="num">Price before</th><th>Since</th><th className="num" style={{ minWidth: 170 }}>New price</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const k = rowKey(r);
                    const d = edits.get(k);
                    const dirty = changes.some((c) => c.kode_produk === r.kode_produk && c.kode_variasi === r.kode_variasi);
                    return (
                      <tr key={k} style={dirty ? { background: "rgba(201,162,39,.10)" } : undefined}>
                        <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.kode_produk}</td>
                        <td style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis" }} title={r.nama_produk || ""}>{r.nama_produk || "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.kode_variasi}</td>
                        <td>{r.nama_variasi || "-"}</td>
                        <td className="num" style={{ color: r.price ? "#e8edf8" : "var(--muted)" }}>
                          {rp(r.price)}{r.inherited && <span style={{ fontSize: 10.5, color: "var(--muted)" }}> (product price)</span>}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{r.since ? fmtDate(r.since) : "—"}</td>
                        <td className="num">
                          <input inputMode="numeric" placeholder={r.has_price ? fmtDigits(String(Math.round(r.price))) : "Rp"} value={fmtDigits(d ?? "")}
                            onChange={(e) => setEdits((m) => { const n = new Map(m); const v = digits(e.target.value); if (v) n.set(k, v); else n.delete(k); return n; })}
                            style={{
                              width: 150, textAlign: "right", padding: "8px 10px", borderRadius: 8, fontSize: 14, color: "#fff",
                              background: "rgba(7,13,26,.85)", border: `1px solid ${dirty ? "var(--gold)" : "rgba(201,162,39,.35)"}`, outline: "none",
                            }} />
                        </td>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                {total.toLocaleString("id-ID")} products / variants · page {page + 1} of {pages}{" "}
                <button className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>{" "}
                <button className="btn-ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
              </div>
              {changes.length > 0 && (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "var(--gold)" }}>{changes.length} price{changes.length === 1 ? "" : "s"} changed</span>
                  <button className="btn-ghost" onClick={() => setEdits(new Map())}>Clear</button>
                  <button className="btn-gold" disabled={busy} onClick={() => { setSince(todayISO()); setDialog("save"); }} style={{ padding: "10px 30px" }}>Save</button>
                </div>
              )}
            </div>
          </>
        )
      ) : log === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
          <table className="tbl day-tbl">
            <thead><tr>
              <th>Saved</th><th>Vendor</th><th>Prod ID</th><th>Product</th><th>Variant</th>
              <th className="num">Price before</th><th className="num">New price</th><th>Since</th><th>By</th>
            </tr></thead>
            <tbody>
              {log.map((l, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12.5 }}>{fmtDate(l.created_at.slice(0, 10))} {l.created_at.slice(11, 16)}</td>
                  <td title={l.stores}>{l.vendor_name || l.stores}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{l.kode_produk}</td>
                  <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }} title={l.nama_produk || ""}>{l.nama_produk || "—"}</td>
                  <td>{l.kode_variasi === "-" ? "—" : (l.nama_variasi || l.kode_variasi)}</td>
                  <td className="num" style={{ color: "var(--muted)" }}>{l.old_price == null ? "Rp 0" : rp(l.old_price)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{rp(l.new_price)}</td>
                  <td>{fmtDate(l.effective_from)}</td>
                  <td style={{ fontSize: 12.5 }}>{l.created_by_name || "—"}{l.source === "apply_all" && <span style={{ color: "var(--muted)" }}> · all vendors</span>}</td>
                </tr>
              ))}
              {log.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No price changes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {dialog && typeof document !== "undefined" && createPortal(
        <div onClick={() => !busy && setDialog(null)} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(4,9,20,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(94vw, 460px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.3))", borderRadius: 18, padding: 26, boxShadow: "0 30px 80px rgba(0,0,0,.7)" }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Start the new price since date?</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
              {dialog === "save"
                ? <>{changes.length} price{changes.length === 1 ? "" : "s"} for <b style={{ color: "#fff" }}>{ven.vendor?.name}</b> ({ven.vendor?.stores.length} store{ven.vendor?.stores.length === 1 ? "" : "s"}). Orders <b>created</b> on or after this date use the new price; earlier orders keep the old one.</>
                : <>Every price of <b style={{ color: "#fff" }}>{ven.vendor?.name}</b> is copied to all other stores (other vendors) from this date. Their own prices for these products are replaced from that date on (the history stays in the Price Log).</>}
            </div>
            <div className="fld"><label>Start date</label><input type="date" value={since} onChange={(e) => setSince(e.target.value)} style={{ colorScheme: "dark" }} /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button className="btn-ghost" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
              <button className="btn-gold" disabled={busy || !since} onClick={dialog === "save" ? save : applyAll} style={{ padding: "10px 28px" }}>{busy ? "Saving…" : dialog === "save" ? "Save prices" : "Copy to all vendors"}</button>
            </div>
          </div>
        </div>, document.body)}
    </div>
  );
}
