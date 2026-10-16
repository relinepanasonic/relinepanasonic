"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Vendors: the supplier(s) we pay in Payout. One vendor has many stores; ONE STORE BELONGS TO ONE VENDOR ONLY
// (choosing a vendor for a store moves it away from its previous vendor). Super Admin and Admin only.
type Vendor = { id: string; name: string; stores: string[] };
type StoreRow = { store_name: string; city: string | null; vendor_id: string | null };

export default function VendorsPanel({ clientId }: { clientId: string }) {
  const [supabase] = useState(() => createClient());
  const [isAdmin, setIsAdmin] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    const { data } = await supabase.rpc("vendor_list", { p_client_id: clientId });
    const d = (data as { vendors: Vendor[]; stores: StoreRow[] } | null) || { vendors: [], stores: [] };
    setVendors(d.vendors || []); setStores(d.stores || []);
  }, [supabase, clientId]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setIsAdmin(["superadmin", "client_admin"].includes((p as { role?: string } | null)?.role || ""));
    })();
  }, [supabase]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const fail = (e: { message: string }) => setMsg({ ok: false, text: e.message.replace(/^[A-Z_]+:\s*/, "") });

  async function add() {
    if (!name.trim()) return;
    const { error } = await supabase.rpc("vendor_upsert", { p_client_id: clientId, p_id: null, p_name: name.trim() });
    if (error) return fail(error);
    setName(""); setMsg(null); load();
  }
  async function rename(v: Vendor) {
    const n = window.prompt("Vendor name", v.name);
    if (!n || n.trim() === v.name) return;
    const { error } = await supabase.rpc("vendor_upsert", { p_client_id: clientId, p_id: v.id, p_name: n.trim() });
    if (error) return fail(error);
    setMsg(null); load();
  }
  async function del(v: Vendor) {
    if (!window.confirm(`Delete vendor ${v.name}? Its ${v.stores.length} store(s) stay, without a vendor.`)) return;
    const { error } = await supabase.rpc("vendor_delete", { p_id: v.id });
    if (error) return fail(error);
    setMsg(null); load();
  }
  async function assign(s: StoreRow, vendorId: string) {
    const { error } = await supabase.rpc("vendor_set_store", { p_client_id: clientId, p_store: s.store_name, p_vendor: vendorId || null });
    if (error) return fail(error);
    setMsg(null); load();
  }

  if (!isAdmin) return null;
  const nameOf = (id: string | null) => vendors.find((v) => v.id === id)?.name || "";

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h3 style={{ margin: 0 }}>🚚 Vendors</h3>
      <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 14px" }}>
        The vendor you pay in Payout. One vendor can have many stores; <b>one store belongs to one vendor only</b> — pick the vendor of each store below.
      </div>
      {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", marginBottom: 10, fontSize: 13 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(360px, 1.6fr)", gap: 18, alignItems: "start" }}>
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {vendors.map((v) => (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(10,22,40,.55)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px" }}>
                <span style={{ flex: 1, fontSize: 13.5, minWidth: 0 }}>{v.name} <span style={{ color: "var(--muted)" }}>· {v.stores.length} store{v.stores.length === 1 ? "" : "s"}</span></span>
                <button className="btn-ghost" onClick={() => rename(v)}>Rename</button>
                <button className="btn-ghost" onClick={() => del(v)} style={{ color: "#f87171" }}>Delete</button>
              </div>
            ))}
            {vendors.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12.5, padding: "8px 2px" }}>No vendors yet.</div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Add vendor" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
              style={{ flex: 1, padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(201,162,39,.22)", background: "rgba(10,22,40,.6)", color: "#e8edf8" }} />
            <button className="btn-gold" onClick={add} style={{ padding: "8px 18px" }}>+</button>
          </div>
        </div>
        <div className="tbl-wrap" style={{ maxHeight: 360 }}>
          <table className="tbl day-tbl">
            <thead><tr><th>Store name</th><th>City</th><th>Vendor</th></tr></thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.store_name}>
                  <td style={{ fontWeight: 600 }}>{s.store_name}</td>
                  <td style={{ color: "var(--muted)" }}>{s.city || "—"}</td>
                  <td>
                    <select value={s.vendor_id || ""} onChange={(e) => assign(s, e.target.value)}
                      style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${s.vendor_id ? "rgba(201,162,39,.35)" : "rgba(248,113,113,.5)"}`, background: "rgba(7,13,26,.85)", color: "#fff", minWidth: 190 }}>
                      <option value="">— no vendor —</option>
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    {s.vendor_id && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>{nameOf(s.vendor_id)}</span>}
                  </td>
                </tr>
              ))}
              {stores.length === 0 && <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>No store names yet — add them in the Store names list above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
