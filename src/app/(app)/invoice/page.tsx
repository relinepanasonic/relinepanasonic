"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

const PACKAGES = [
  { name: "Paket New Store",        type: "subscription", months: 3, price: 3_500_000 },
  { name: "Paket Lapak",            type: "subscription", months: 3, price: 5_000_000 },
  { name: "Paket Juragan",          type: "subscription", months: 3, price: 8_000_000 },
  { name: "Paket Sultan",           type: "subscription", months: 3, price: 10_000_000 },
  { name: "Big Company",            type: "subscription", months: 3, price: 15_000_000 },
  { name: "Trial Optimise 1 mo",    type: "subscription", months: 1, price: 2_000_000 },
  { name: "Add on Upload Etalase",  type: "addon", months: 0, price: 300_000 },
  { name: "Friends Order",          type: "addon", months: 0, price: 350_000 },
  { name: "Tiktok Affilitor Hunt",  type: "addon", months: 0, price: 1_000_000 },
  { name: "Foto + E-commerce Edit", type: "addon", months: 0, price: 1_500_000 },
  { name: "Video generate AI",      type: "addon", months: 0, price: 500_000 },
  { name: "Live + Pre-Content",     type: "addon", months: 0, price: 3_000_000 },
  { name: "Tiktok Short Konten",    type: "addon", months: 0, price: 2_000_000 },
];

type Invoice = {
  id: string;
  owner: string | null;
  brand: string | null;
  store_name: string | null;
  package_name: string;
  package_type: string;
  price_idr: number;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  created_at: string;
};

type FormState = {
  owner: string; brand: string; store_name: string;
  package_name: string; price_idr: string;
  start_date: string; end_date: string; notes: string;
};

const emptyForm: FormState = {
  owner: "", brand: "", store_name: "", package_name: "",
  price_idr: "", start_date: "", end_date: "", notes: "",
};

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function daysLeft(endDate: string): number {
  const end = new Date(endDate + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtIDR(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

type StoreLink = { owner: string | null; brand: string | null; store_name: string | null };

export default function InvoicePage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [links, setLinks] = useState<StoreLink[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [stores, setStores] = useState<string[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [flt, setFlt] = useState({ owner: "", package_type: "" });

  const load = useCallback(async (cid: string) => {
    if (!cid) return;
    const { data } = await supabase
      .from("invoices")
      .select("id,owner,brand,store_name,package_name,package_type,price_idr,start_date,end_date,notes,created_at")
      .eq("client_id", cid)
      .order("created_at", { ascending: false });
    setInvoices((data as Invoice[]) || []);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);
      if (!cid) return;
      const { data: sl } = await supabase
        .from("store_links").select("owner,brand,store_name").eq("client_id", cid).order("created_at");
      const linkData = (sl as StoreLink[]) || [];
      setLinks(linkData);
      const uniq = (xs: (string | null)[]) => Array.from(new Set(xs.filter(Boolean) as string[])).sort();
      setOwners(uniq(linkData.map((l) => l.owner)));
      setBrands(uniq(linkData.map((l) => l.brand)));
      setStores(uniq(linkData.map((l) => l.store_name)));
      load(cid);
    })();
  }, [supabase, load]);

  function setF(k: keyof FormState, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function pickPackage(name: string) {
    const pkg = PACKAGES.find((p) => p.name === name);
    if (!pkg) { setF("package_name", name); return; }
    const endDate = form.start_date && pkg.months > 0 ? addMonths(form.start_date, pkg.months) : "";
    setForm((f) => ({ ...f, package_name: name, price_idr: String(pkg.price), end_date: endDate }));
  }

  function pickStart(v: string) {
    const pkg = PACKAGES.find((p) => p.name === form.package_name);
    const endDate = v && pkg && pkg.months > 0 ? addMonths(v, pkg.months) : "";
    setForm((f) => ({ ...f, start_date: v, end_date: endDate }));
  }

  function openAdd() {
    setForm(emptyForm); setEditId(null); setMsg(""); setShowForm(true);
  }

  function openEdit(inv: Invoice) {
    setForm({
      owner: inv.owner || "", brand: inv.brand || "", store_name: inv.store_name || "",
      package_name: inv.package_name, price_idr: String(inv.price_idr),
      start_date: inv.start_date, end_date: inv.end_date || "", notes: inv.notes || "",
    });
    setEditId(inv.id); setMsg(""); setShowForm(true);
  }

  async function save() {
    if (!form.package_name || !form.start_date) { setMsg("Package and Start Date are required."); return; }
    setSaving(true); setMsg("");
    const pkg = PACKAGES.find((p) => p.name === form.package_name);
    const payload = {
      client_id: clientId,
      owner: form.owner || null,
      brand: form.brand || null,
      store_name: form.store_name || null,
      package_name: form.package_name,
      package_type: pkg?.type || "addon",
      price_idr: Number(form.price_idr) || 0,
      start_date: form.start_date,
      end_date: form.end_date || null,
      notes: form.notes || null,
    };
    const { error } = editId
      ? await supabase.from("invoices").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", editId)
      : await supabase.from("invoices").insert(payload);
    setSaving(false);
    if (error) { setMsg("✗ " + error.message); return; }
    setShowForm(false); setForm(emptyForm); setEditId(null);
    load(clientId);
  }

  async function del(id: string) {
    if (!confirm("Delete this invoice?")) return;
    await supabase.from("invoices").delete().eq("id", id);
    load(clientId);
  }

  const activePkg = PACKAGES.find((p) => p.name === form.package_name);
  const isAddon = activePkg?.type === "addon";

  // Subscriptions expiring within 30 days (not expired, not add-ons)
  const expiring = invoices.filter((inv) => {
    if (inv.package_type !== "subscription" || !inv.end_date) return false;
    const d = daysLeft(inv.end_date);
    return d >= 0 && d <= 30;
  });

  const shown = invoices.filter((inv) =>
    (!flt.owner || inv.owner === flt.owner) &&
    (!flt.package_type || inv.package_type === flt.package_type)
  );
  const fOwners = Array.from(new Set(invoices.map((i) => i.owner).filter(Boolean) as string[])).sort();

  return (
    <>
      {/* Expiry notification banner */}
      {expiring.length > 0 && (
        <div style={{ background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 14, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, color: "#fbbf24", fontSize: 13, marginBottom: 6 }}>
            ⏰ {expiring.length} subscription{expiring.length > 1 ? "s" : ""} expiring within 30 days
          </div>
          {expiring.map((inv) => {
            const d = daysLeft(inv.end_date!);
            return (
              <div key={inv.id} style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>
                <span style={{ color: d <= 7 ? "#f87171" : "#fbbf24", fontWeight: 700 }}>{d}d left</span>
                {" — "}{[inv.store_name, inv.owner].filter(Boolean).join(" / ")} · {inv.package_name} · ends {fmtDate(inv.end_date!)}
              </div>
            );
          })}
        </div>
      )}

      {/* Invoice list panel */}
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>Invoice List</h3>
            <div className="hint">Service packages per store. Subscriptions = 3 months; add-ons = one-time.</div>
          </div>
          <button className="btn-gold" onClick={openAdd}>+ New Invoice</button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <div className="fld" style={{ minWidth: 160 }}>
            <label>Owner</label>
            <select value={flt.owner} onChange={(e) => setFlt((f) => ({ ...f, owner: e.target.value }))}>
              <option value="">All owners</option>
              {fOwners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="fld" style={{ minWidth: 140 }}>
            <label>Type</label>
            <select value={flt.package_type} onChange={(e) => setFlt((f) => ({ ...f, package_type: e.target.value }))}>
              <option value="">All types</option>
              <option value="subscription">Subscription</option>
              <option value="addon">Add-on</option>
            </select>
          </div>
          {(flt.owner || flt.package_type) && (
            <button className="btn-ghost" onClick={() => setFlt({ owner: "", package_type: "" })} style={{ height: 38, alignSelf: "flex-end" }}>Reset</button>
          )}
          <span style={{ marginLeft: "auto", alignSelf: "flex-end", fontSize: 11, fontWeight: 700, color: "var(--gold)", background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "3px 12px" }}>
            {shown.length} / {invoices.length}
          </span>
        </div>

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Store</th><th>Owner</th><th>Brand</th>
                <th>Package</th><th>Type</th>
                <th className="num">Price</th>
                <th>Start</th><th>End</th><th>Status</th>
                <th>Notes</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((inv) => {
                const d = inv.end_date ? daysLeft(inv.end_date) : null;
                const statusPill = inv.package_type === "addon"
                  ? <span className="pill warn">One-time</span>
                  : d === null ? null
                  : d < 0 ? <span className="pill bad">Expired</span>
                  : d <= 7 ? <span className="pill bad">{d}d</span>
                  : d <= 30 ? <span className="pill warn">{d}d left</span>
                  : <span className="pill good">Active</span>;
                return (
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 600 }}>{inv.store_name || "—"}</td>
                    <td>{inv.owner || "—"}</td>
                    <td>{inv.brand || "—"}</td>
                    <td>{inv.package_name}</td>
                    <td>
                      <span className={`pill ${inv.package_type === "subscription" ? "good" : "warn"}`}>
                        {inv.package_type === "subscription" ? "Sub" : "Add-on"}
                      </span>
                    </td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{fmtIDR(inv.price_idr)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(inv.start_date)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{inv.end_date ? fmtDate(inv.end_date) : "—"}</td>
                    <td>{statusPill}</td>
                    <td style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }} title={inv.notes || ""}>
                      {inv.notes || "—"}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openEdit(inv)} style={editBtnStyle}>Edit</button>
                        <button onClick={() => del(inv.id)} style={delBtnStyle}>Del</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={11} style={{ color: "var(--muted)", textAlign: "center", padding: 28 }}>
                  {invoices.length ? "No invoices match these filters" : "No invoices yet — click New Invoice to add one"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit modal — portaled to body to avoid .panel clipping */}
      {showForm && typeof document !== "undefined" && createPortal(
        <div onClick={() => setShowForm(false)} style={overlayStyle}>
          <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
            <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--line)", fontWeight: 800, fontSize: 16, color: "#fff" }}>
              {editId ? "Edit Invoice" : "New Invoice"}
            </div>

            <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
              {msg && <div style={{ color: "#ff9a9a", fontSize: 12, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 8, padding: "8px 12px" }}>{msg}</div>}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <MFld label="Owner">
                  <select value={form.owner} onChange={(e) => setF("owner", e.target.value)}>
                    <option value="">— Select —</option>
                    {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </MFld>
                <MFld label="Brand">
                  <select value={form.brand} onChange={(e) => setF("brand", e.target.value)}>
                    <option value="">— Select —</option>
                    {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </MFld>
              </div>

              <MFld label="Store Name">
                <select value={form.store_name} onChange={(e) => {
                  const store = e.target.value;
                  const link = links.find((l) => l.store_name === store);
                  setForm((f) => ({
                    ...f,
                    store_name: store,
                    owner: link?.owner || f.owner,
                    brand: link?.brand || f.brand,
                  }));
                }}>
                  <option value="">— Select —</option>
                  {stores.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </MFld>

              <MFld label="Package">
                <select value={form.package_name} onChange={(e) => pickPackage(e.target.value)}>
                  <option value="">— Select package —</option>
                  <optgroup label="── Subscriptions ──">
                    {PACKAGES.filter((p) => p.type === "subscription").map((p) => (
                      <option key={p.name} value={p.name}>{p.name} — {fmtIDR(p.price)}</option>
                    ))}
                  </optgroup>
                  <optgroup label="── Add-ons (one-time) ──">
                    {PACKAGES.filter((p) => p.type === "addon").map((p) => (
                      <option key={p.name} value={p.name}>{p.name} — {fmtIDR(p.price)}</option>
                    ))}
                  </optgroup>
                </select>
              </MFld>

              <MFld label="Price (IDR)">
                <input type="number" value={form.price_idr} onChange={(e) => setF("price_idr", e.target.value)} placeholder="Auto-filled from package" min="0" />
              </MFld>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <MFld label="Start Date">
                  <input type="date" value={form.start_date} onChange={(e) => pickStart(e.target.value)} />
                </MFld>
                <MFld label={isAddon ? "End Date (optional)" : "End Date (auto)"}>
                  <input type="date" value={form.end_date}
                    readOnly={!isAddon} disabled={!isAddon}
                    style={isAddon ? {} : { opacity: .65, cursor: "not-allowed" }}
                    onChange={isAddon ? (e) => setF("end_date", e.target.value) : undefined} />
                  {!isAddon && form.end_date && (
                    <span style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>
                      {activePkg?.months}mo after start · {fmtDate(form.end_date)}
                    </span>
                  )}
                </MFld>
              </div>

              <MFld label="Notes">
                <input type="text" value={form.notes} onChange={(e) => setF("notes", e.target.value)} placeholder="Optional note…" />
              </MFld>
            </div>

            <div style={{ padding: "12px 20px 16px", borderTop: "1px solid var(--line)", display: "flex", gap: 10 }}>
              <button className="btn-gold" onClick={save} disabled={saving} style={{ flex: 1 }}>
                {saving ? "Saving…" : editId ? "Save Changes" : "Create Invoice"}
              </button>
              <button className="btn-ghost" onClick={() => setShowForm(false)} style={{ flex: 1 }}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function MFld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fld" style={{ minWidth: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(2,6,16,.75)",
  zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
const modalStyle: React.CSSProperties = {
  width: "min(94vw,520px)", maxHeight: "calc(100vh - 32px)", display: "flex", flexDirection: "column",
  background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,.6)",
};
const editBtnStyle: React.CSSProperties = {
  background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)",
  color: "var(--gold)", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12,
};
const delBtnStyle: React.CSSProperties = {
  background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)",
  color: "#ff9a9a", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12,
};
