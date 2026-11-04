"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { CATALOG_EXAMPLE, CATALOG_HEADER, parseCatalogMatrix } from "@/lib/catalogXls";

// Price Calculator > Product Catalog: the Catalog log (Catalog ID automatic | Date Create | Date Active | Total SKU) and, per Catalog, its products with
// Harga Beli (what we pay the dealer, the calculator's Modal Produk) and Harga Jual. "New Harga Beli" starts a new Catalog when we buy from the dealer.
// The Catalog in force feeds Price Guard, Product URL and Perhitungan Harga.
type Supabase = ReturnType<typeof createClient>;
type SrpLogRow = { id: string; srp_no: string; created_at: string; active_from: string; created_by: string | null; total_sku: number; in_force: boolean; vendor_id: string | null; vendor_name: string | null };
type SrpItem = { id: string; prod_id: string; product_name: string; harga_beli: number | null; harga_srp: number | null };

const rp = (n: number | null | undefined) => n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID");
const today = () => new Date().toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function dmy(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v); if (Number.isNaN(d.getTime())) return "—";
  const j = new Date(d.getTime() + 7 * 3600_000);
  return `${String(j.getUTCDate()).padStart(2, "0")} ${MON[j.getUTCMonth()]} ${j.getUTCFullYear()}`;
}

export function Modal({ children, onClose, width = 640 }: { children: React.ReactNode; onClose: () => void; width?: number }) {
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(2,6,16,.72)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(13,26,54,.98)", border: "1px solid rgba(201,162,39,.28)", borderRadius: 18, padding: 22, width: `min(${width}px, 100%)`, boxShadow: "0 30px 80px rgba(0,0,0,.6)" }}>{children}</div>
    </div>,
    document.body,
  );
}

/* ── Product Catalog: the Catalog log first (Catalog ID | Date Create | Date Active | Total SKU), then the products of one Catalog ── */
export function CatalogTab({ supabase, clientId, isAdmin, tick, onChanged }: { supabase: Supabase; clientId: string; isAdmin: boolean; tick: number; onChanged: () => void }) {
  const [listId, setListId] = useState<string | null>(null);
  const [rows, setRows] = useState<SrpLogRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("pr_srp_lists_log", { p_client_id: clientId });
      setErr(error ? error.message : "");
      setRows((data as SrpLogRow[]) || []);
    })();
  }, [supabase, clientId, tick, listId]);

  if (listId) return <SrpListView supabase={supabase} isAdmin={isAdmin} listId={listId} onBack={() => { setListId(null); onChanged(); }} onChanged={onChanged} />;

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div className="hint" style={{ flex: 1, margin: 0 }}>Every row is a Catalog of one vendor: its product list with the Harga Beli (what we pay that vendor) and Harga Jual, saved each time we buy. The store of a calculator line decides the vendor, so each vendor can have its own Harga Beli. The Catalog in force of a vendor is the one with the latest Date Active up to today; a store whose vendor has no Catalog uses the Default one. Open a Catalog to see or change its products.</div>
        {isAdmin && <button className="btn-gold" onClick={() => setCreating(true)} style={{ padding: "10px 22px" }}>+ New Harga Beli</button>}
      </div>
      {err && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 10 }}>✗ {err}</div>}
      {rows === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "66vh" }}>
          <table className="tbl day-tbl">
            <thead><tr><th>Catalog ID</th><th>Vendor</th><th>Date Create</th><th>Date Active</th><th className="num">Total SKU</th><th>Created by</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setListId(r.id)} style={{ cursor: "pointer" }}>
                  <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{r.srp_no}</td>
                  <td>{r.vendor_name || <span style={{ color: "var(--muted)" }}>Default (all stores)</span>}</td>
                  <td>{dmy(r.created_at)}</td>
                  <td>{dmy(r.active_from + "T00:00:00+07:00")}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{r.total_sku}</td>
                  <td>{r.created_by || "—"}</td>
                  <td>{r.in_force ? <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 800, border: "1px solid rgba(201,162,39,.5)", color: "var(--gold)" }}>In force</span> : new Date(r.active_from + "T00:00:00+07:00").getTime() > nowMs ? <span style={{ color: "var(--muted)", fontSize: 12 }}>Scheduled</span> : <span style={{ color: "var(--muted)", fontSize: 12 }}>Replaced</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No Harga Beli yet — press + New Harga Beli, then add the products or import them from an XLS.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {creating && <CreateSrpModal supabase={supabase} clientId={clientId} hasCurrent={!!rows?.length} onClose={(id) => { setCreating(false); if (id) { onChanged(); setListId(id); } }} />}
    </>
  );
}

function CreateSrpModal({ supabase, clientId, hasCurrent, onClose }: { supabase: Supabase; clientId: string; hasCurrent: boolean; onClose: (newId: string | null) => void }) {
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [vendor, setVendor] = useState("");
  useEffect(() => { (async () => { const { data } = await supabase.from("vendors").select("id, name").eq("client_id", clientId).order("name"); setVendors((data as { id: string; name: string }[]) || []); })(); }, [supabase, clientId]);
  const [active, setActive] = useState(today());
  const [copy, setCopy] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  async function create() {
    setErr(""); setSaving(true);
    const { data, error } = await supabase.rpc("pr_srp_list_create", { p_client_id: clientId, p_active_from: active || null, p_copy: hasCurrent && copy, p_vendor_id: vendor || null });
    setSaving(false);
    if (error) { setErr(error.message.replace(/^[A-Z_]+:\s*/, "")); return; }
    onClose(data as string);
  }
  return (
    <Modal onClose={() => onClose(null)} width={520}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 6 }}>New Harga Beli</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>Use this when we buy from a vendor at a new price. Pick the vendor (Core → Connector): its stores will use this Harga Beli. The Catalog ID is given automatically (CAT-YYMM-NNN).</div>
      <div className="fld" style={{ marginBottom: 12 }}><label>Vendor</label>
        <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
          <option value="">Default (all stores without a vendor Catalog)</option>
          {vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select></div>
      <div className="fld" style={{ maxWidth: 220 }}><label>Date Active</label><input type="date" value={active} onChange={(e) => setActive(e.target.value)} style={{ colorScheme: "dark" }} /></div>
      {hasCurrent && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Start as a copy of the Catalog in force now (then change the prices that changed)
        </label>
      )}
      {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <button className="btn-ghost" onClick={() => onClose(null)}>Cancel</button>
        <button className="btn-gold" disabled={saving} onClick={create} style={{ padding: "10px 24px" }}>{saving ? "Creating…" : "Create"}</button>
      </div>
    </Modal>
  );
}

function SrpListView({ supabase, isAdmin, listId, onBack, onChanged }: { supabase: Supabase; isAdmin: boolean; listId: string; onBack: () => void; onChanged: () => void }) {
  const [head, setHead] = useState<{ srp_no: string; created_at: string; active_from: string; vendor_id: string | null } | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [rows, setRows] = useState<SrpItem[] | null>(null);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<SrpItem> | null>(null);
  const [activeEdit, setActiveEdit] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [local, setLocal] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: h } = await supabase.from("pr_srp_lists").select("srp_no, created_at, active_from, vendor_id").eq("id", listId).single();
      setHead(h as typeof head);
      const vid = (h as { vendor_id: string | null } | null)?.vendor_id;
      if (vid) { const { data: v } = await supabase.from("vendors").select("name").eq("id", vid).single(); setVendorName((v as { name: string } | null)?.name || ""); } else setVendorName(""); setActiveEdit((h as { active_from: string } | null)?.active_from || "");
      const { data } = await supabase.from("pr_srp_items").select("id, prod_id, product_name, harga_beli, harga_srp").eq("list_id", listId).order("product_name");
      setRows((data as SrpItem[]) || []);
    })();
  }, [supabase, listId, local]);

  const shown = (rows || []).filter((r) => { const t = q.trim().toLowerCase(); return !t || r.product_name.toLowerCase().includes(t) || r.prod_id.toLowerCase().includes(t); });
  const refresh = () => { setLocal((n) => n + 1); onChanged(); };

  async function saveActive() {
    const { error } = await supabase.from("pr_srp_lists").update({ active_from: activeEdit }).eq("id", listId);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Date Active saved." }); refresh();
  }
  async function delList() {
    if (!window.confirm(`Delete ${head?.srp_no} with all its ${rows?.length ?? 0} products? Price Guard and the calculator go back to the Catalog in force before it.`)) return;
    const { error } = await supabase.from("pr_srp_lists").delete().eq("id", listId);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    onBack();
  }
  async function delItem(r: SrpItem) {
    if (!window.confirm(`Remove ${r.product_name} from ${head?.srp_no}?`)) return;
    await supabase.from("pr_srp_items").delete().eq("id", r.id); refresh();
  }

  // the XLS template is the empty sheet (one example row); the export is this Catalog as it is now, so it can be edited and imported back
  async function downloadXls(withRows: boolean) {
    const XLSX = await import("xlsx");
    const body: (string | number)[][] = withRows ? (rows || []).map((r, i) => [i + 1, r.prod_id, r.product_name, r.harga_beli ?? "", r.harga_srp ?? ""]) : [CATALOG_EXAMPLE as (string | number)[]];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[...CATALOG_HEADER], ...body]);
    ws["!cols"] = [{ wch: 6 }, { wch: 46 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, "Product Catalog");
    const guide = XLSX.utils.aoa_to_sheet([
      ["How to fill"], [""],
      ["Prod ID", "Required and unique inside the Catalog: it is the key. A Prod ID that is already in this Catalog is UPDATED, a new one is ADDED."],
      ["Product Name", "Required."],
      ["Harga Beli", "Cost price in Rp. Perhitungan Harga uses it as Modal Produk."],
      ["Harga Jual", "Selling price guide in Rp. Price Guard compares the competitors with it."],
      ["Catalog ID", "Not in the sheet: it is automatic, one per Catalog."],
      ["No", "Only a counter, it is ignored."],
    ]);
    guide["!cols"] = [{ wch: 18 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(wb, guide, "Guide");
    XLSX.writeFile(wb, `${head?.srp_no || "srp"}-${withRows ? "export" : "template"}.xlsx`);
  }

  async function importXls(file: File) {
    setImporting(true); setMsg(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });
      const parsed = parseCatalogMatrix(matrix);
      if (parsed.error) { setMsg({ ok: false, text: parsed.error }); return; }
      if (!parsed.rows.length) { setMsg({ ok: false, text: "No product row found in the sheet." }); return; }
      const total = { added: 0, updated: 0, unchanged: 0, errors: [] as { row: number; error: string }[] };
      for (let i = 0; i < parsed.rows.length; i += 500) {
        const { data, error } = await supabase.rpc("pr_srp_items_import", { p_list: listId, p_rows: parsed.rows.slice(i, i + 500) });
        if (error) { setMsg({ ok: false, text: error.message }); return; }
        const r = data as typeof total;
        total.added += r.added; total.updated += r.updated; total.unchanged += r.unchanged; total.errors.push(...r.errors.map((e) => ({ row: e.row + i, error: e.error })));
      }
      const bad = [...parsed.skipped.map((x) => `row ${x.row}: ${x.reason}`), ...total.errors.map((x) => `product ${x.row}: ${x.error}`)];
      setMsg({ ok: bad.length === 0, text: `${total.added} added · ${total.updated} updated · ${total.unchanged} unchanged${bad.length ? ` · ${bad.length} skipped: ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "…" : ""}` : ""}` });
      refresh();
    } finally { setImporting(false); }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <button className="btn-ghost" onClick={onBack}>← Catalog log</button>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", fontFamily: "monospace" }}>{head?.srp_no || "…"}</div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Vendor: <b style={{ color: "var(--gold)" }}>{vendorName || "Default (all stores)"}</b></div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Created {dmy(head?.created_at)} · {rows?.length ?? 0} SKU</div>
        {isAdmin && head && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Date Active</span>
            <input type="date" value={activeEdit} onChange={(e) => setActiveEdit(e.target.value)} style={{ colorScheme: "dark" }} />
            {activeEdit !== head.active_from && <button className="btn-gold" onClick={saveActive} style={{ padding: "7px 14px" }}>Save date</button>}
            <button className="btn-ghost" onClick={delList} style={{ color: "#f87171" }}>Delete Catalog</button>
          </div>
        )}
        {!isAdmin && head && <div style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted)" }}>Date Active {dmy(head.active_from + "T00:00:00+07:00")}</div>}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div className="fld" style={{ minWidth: 260, flex: 1 }}><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product name or Prod ID" /></div>
        <button className="btn-ghost" onClick={() => downloadXls(false)}>⬇ Template XLS</button>
        <button className="btn-ghost" onClick={() => downloadXls(true)} disabled={!rows?.length}>⬇ Export XLS</button>
        {isAdmin && (
          <>
            <label className="btn-ghost" style={{ cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.6 : 1 }}>
              {importing ? "Importing…" : "Import XLS"}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} disabled={importing}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importXls(f); e.target.value = ""; }} />
            </label>
            <button className="btn-gold" onClick={() => setEdit({})} style={{ padding: "10px 22px" }}>+ Add product</button>
          </>
        )}
      </div>
      {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", fontSize: 13, marginBottom: 10 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}
      {rows === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
          <table className="tbl day-tbl">
            <thead><tr><th className="num">No</th><th>Prod ID</th><th>Product Name</th><th className="num">Harga Beli</th><th className="num">Harga Jual</th><th></th></tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id}>
                  <td className="num">{i + 1}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.prod_id}</td>
                  <td style={{ minWidth: 240, maxWidth: 420, whiteSpace: "normal", overflowWrap: "anywhere" }}>{r.product_name}</td>
                  <td className="num">{rp(r.harga_beli)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{rp(r.harga_srp)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {isAdmin && <button className="btn-ghost" onClick={() => setEdit(r)}>Edit</button>}{" "}
                    {isAdmin && <button className="btn-ghost" onClick={() => delItem(r)} style={{ color: "#f87171" }}>✕</button>}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{rows.length ? "No product matches." : "No product in this Catalog yet — press + Add product, or fill the XLS template and Import it."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ItemModal supabase={supabase} listId={listId} srpNo={head?.srp_no || ""} item={edit} onClose={(saved) => { setEdit(null); if (saved) refresh(); }} />}
    </>
  );
}

function ItemModal({ supabase, listId, srpNo, item, onClose }: { supabase: Supabase; listId: string; srpNo: string; item: Partial<SrpItem>; onClose: (saved: boolean) => void }) {
  const isNew = !item.id;
  const [f, setF] = useState({ prod_id: item.prod_id || "", product_name: item.product_name || "", harga_beli: item.harga_beli != null ? String(item.harga_beli) : "", harga_srp: item.harga_srp != null ? String(item.harga_srp) : "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^\d]/g, "")));

  async function save() {
    setErr("");
    if (!f.prod_id.trim() || !f.product_name.trim()) { setErr("Prod ID and Product Name are required."); return; }
    setSaving(true);
    const { error } = await supabase.rpc("pr_srp_item_save", { p_list: listId, p_item: item.id || null, p_prod_id: f.prod_id, p_product_name: f.product_name, p_harga_beli: num(f.harga_beli), p_harga_srp: num(f.harga_srp) });
    setSaving(false);
    if (error) { setErr(/duplicate|unique/i.test(error.message) ? "This Prod ID is already in this Catalog." : error.message.replace(/^[A-Z_]+:\s*/, "")); return; }
    onClose(true);
  }

  return (
    <Modal onClose={() => onClose(false)}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 4 }}>{isNew ? "Add product" : "Edit product"}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14, fontFamily: "monospace" }}>{srpNo}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="fld" style={{ gridColumn: "1 / -1" }}><label>Prod ID</label><input value={f.prod_id} onChange={(e) => setF({ ...f, prod_id: e.target.value })} placeholder="e.g. 9078737678 or CS/CU-YN18AKJ" /></div>
        <div className="fld" style={{ gridColumn: "1 / -1" }}><label>Product Name</label><input value={f.product_name} onChange={(e) => setF({ ...f, product_name: e.target.value })} placeholder="AC Panasonic 2 PK CS-YN18AKJ" /></div>
        <div className="fld"><label>Harga Beli (Rp)</label><input inputMode="numeric" value={f.harga_beli} onChange={(e) => setF({ ...f, harga_beli: e.target.value.replace(/[^\d]/g, "") })} placeholder="5800000" /></div>
        <div className="fld"><label>Harga Jual (Rp)</label><input inputMode="numeric" value={f.harga_srp} onChange={(e) => setF({ ...f, harga_srp: e.target.value.replace(/[^\d]/g, "") })} placeholder="7500000" /></div>
      </div>
      {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn-ghost" onClick={() => onClose(false)}>Cancel</button>
        <button className="btn-gold" disabled={saving} onClick={save} style={{ padding: "10px 24px" }}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}
