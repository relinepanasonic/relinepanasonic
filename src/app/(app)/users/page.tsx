"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Profile = {
  id: string; email: string | null; display_name: string | null;
  role: string; client_id: string | null; scope_city: string | null; scope_store: string | null;
};
type Client = { id: string; name: string };
type StoreLink = { owner: string | null; brand: string | null; store_name: string | null };

const ROLES = [
  { v: "superadmin",     l: "Super Admin" },
  { v: "client_admin",   l: "Client Admin" },
  { v: "branch_manager", l: "Owner" },
  { v: "store_user",     l: "Store" },
];
const roleLabel = (r: string) => ROLES.find((x) => x.v === r)?.l || r;

const blank = {
  id: "", email: "", password: "", display_name: "",
  role: "branch_manager", client_id: "", scope_city: "", scope_store: "",
};

export default function UsersPage() {
  const [supabase] = useState(() => createClient());
  const [me, setMe] = useState<{ role: string; client_id: string | null }>();
  const [rows, setRows] = useState<Profile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [links, setLinks] = useState<StoreLink[]>([]);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const { data } = await supabase.from("profiles")
      .select("id,email,display_name,role,client_id,scope_city,scope_store")
      .order("display_name");
    setRows((data as Profile[]) || []);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("role,client_id").eq("id", user.id).single();
      setMe(p as { role: string; client_id: string | null });
      // Load clients + store_links for dropdowns
      const [{ data: cs }, { data: sl }] = await Promise.all([
        supabase.from("clients").select("id,name").order("name"),
        supabase.from("store_links").select("owner,brand,store_name").order("owner"),
      ]);
      setClients((cs as Client[]) || []);
      setLinks((sl as StoreLink[]) || []);
      reload();
    })();
  }, [supabase, reload]);

  function openAdd() { setEditing(false); setForm({ ...blank, client_id: me?.client_id || "" }); setMsg(""); }
  function openEdit(r: Profile) {
    setEditing(true);
    setForm({ id: r.id, email: r.email || "", password: "", display_name: r.display_name || "",
      role: r.role, client_id: r.client_id || "", scope_city: r.scope_city || "", scope_store: r.scope_store || "" });
    setMsg("");
  }

  async function save() {
    if (!form) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/users", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok) { setMsg("✗ " + j.error); setBusy(false); return; }
      setForm(null); await reload();
    } catch (e) { setMsg("✗ " + String(e)); }
    setBusy(false);
  }

  async function del(r: Profile) {
    if (!confirm(`Delete user ${r.display_name || r.email}? This cannot be undone.`)) return;
    const res = await fetch("/api/users", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id }),
    });
    const j = await res.json();
    if (!res.ok) { alert(j.error); return; }
    reload();
  }

  const isSuper = me?.role === "superadmin";
  const inp: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 10, border: "1px solid rgba(201,162,39,.25)", background: "rgba(10,22,40,.6)", color: "var(--text)", fontSize: 13 };

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div><h3 style={{ margin: 0 }}>User Management</h3><div className="hint">Add, edit or remove dashboard users</div></div>
        <button className="btn-gold" onClick={openAdd}>+ Add User</button>
      </div>

      <div className="tbl-wrap" style={{ marginTop: 14 }}>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Owner</th><th>Store</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.display_name || "—"}</td>
                <td>{r.email || "—"}</td>
                <td><span className="pill good">{roleLabel(r.role)}</span></td>
                <td>{r.scope_city || "—"}</td>
                <td>{r.scope_store || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="row-act" onClick={() => openEdit(r)} style={actBtn}>Edit</button>
                  <button className="row-act del" onClick={() => del(r)} style={{ ...actBtn, ...delBtn }}>Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>No users yet</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Modal — portaled to body so the panel's overflow/backdrop-filter can't clip it */}
      {form && typeof document !== "undefined" && createPortal(
        <div onClick={() => setForm(null)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={modal}>
            {/* sticky title */}
            <h3 style={{ margin: "0 0 14px", color: "#fff", flexShrink: 0 }}>{editing ? "Edit user" : "Add user"}</h3>
            {/* scrollable fields */}
            <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
              <div style={{ display: "grid", gap: 12, paddingRight: 4 }}>
                {!editing && (
                  <Fld label="Email"><input style={inp} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Fld>
                )}
                <Fld label="Name"><input style={inp} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Fld>
                <Fld label={editing ? "Reset password (blank = keep)" : "Password"}>
                  <input style={inp} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing ? "leave blank to keep" : ""} />
                </Fld>
                <Fld label="Role">
                  <select style={inp} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    {ROLES.filter((r) => isSuper || r.v !== "superadmin").map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
                  </select>
                </Fld>
                {isSuper && (form.role === "branch_manager" || form.role === "store_user") && (
                  <Fld label="Client">
                    <select style={inp} value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                      <option value="">Select client…</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Fld>
                )}
                {/* Owner role: pick owner from Core List */}
                {form.role === "branch_manager" && (() => {
                  const ownerOpts = Array.from(new Set(links.map((l) => l.owner).filter(Boolean) as string[])).sort();
                  return (
                    <Fld label="Owner">
                      <select style={inp} value={form.scope_city}
                        onChange={(e) => setForm({ ...form, scope_city: e.target.value, scope_store: "" })}>
                        <option value="">Select owner…</option>
                        {ownerOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </Fld>
                  );
                })()}
                {/* Store role: pick store → auto-fills Owner */}
                {form.role === "store_user" && (() => {
                  const storeOpts = Array.from(new Set(links.map((l) => l.store_name).filter(Boolean) as string[])).sort();
                  const autoOwner = links.find((l) => l.store_name === form.scope_store)?.owner || "";
                  return (
                    <>
                      <Fld label="Store">
                        <select style={inp} value={form.scope_store}
                          onChange={(e) => {
                            const store = e.target.value;
                            const link = links.find((l) => l.store_name === store);
                            setForm({ ...form, scope_store: store, scope_city: link?.owner || "" });
                          }}>
                          <option value="">Select store…</option>
                          {storeOpts.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </Fld>
                      {autoOwner && (
                        <div style={{ fontSize: 12, color: "var(--gold)", background: "rgba(201,162,39,.08)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "7px 12px" }}>
                          Owner: <strong>{autoOwner}</strong>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            {/* sticky footer */}
            {msg && <div style={{ color: "#ff9a9a", fontSize: 13, marginTop: 10, flexShrink: 0 }}>{msg}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end", flexShrink: 0 }}>
              <button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn-gold" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const actBtn: React.CSSProperties = { background: "rgba(201,162,39,.15)", border: "1px solid rgba(201,162,39,.3)", color: "var(--gold)", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12, marginRight: 6 };
const delBtn: React.CSSProperties = { background: "rgba(255,80,80,.12)", borderColor: "rgba(255,90,90,.3)", color: "#ff9a9a" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.7)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const modal: React.CSSProperties = { width: "min(94vw,440px)", maxHeight: "calc(100vh - 32px)", display: "flex", flexDirection: "column", background: "rgba(13,26,54,.98)", border: "1px solid rgba(201,162,39,.3)", borderRadius: 16, padding: 24, boxShadow: "0 24px 70px rgba(0,0,0,.55)" };

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", display: "block", marginBottom: 4 }}>{label}</label>{children}</div>;
}
