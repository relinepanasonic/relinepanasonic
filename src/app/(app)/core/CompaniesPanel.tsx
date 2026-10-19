"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Companies: the tax entity (with its NPWP) that owns stores. One company has many stores; ONE STORE BELONGS TO ONE
// COMPANY ONLY (choosing another company for a store moves it). Pajak is reported per company and per store.
type Company = { id: string; name: string; npwp: string | null; stores: string[] };
type StoreRow = { store_name: string; city: string | null; company_id: string | null };
const field: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(201,162,39,.22)", background: "rgba(10,22,40,.6)", color: "#e8edf8" };

export default function CompaniesPanel({ clientId }: { clientId: string }) {
  const [supabase] = useState(() => createClient());
  const [isAdmin, setIsAdmin] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [name, setName] = useState("");
  const [npwp, setNpwp] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    const { data } = await supabase.rpc("company_list", { p_client_id: clientId });
    const d = (data as { companies: Company[]; stores: StoreRow[] } | null) || { companies: [], stores: [] };
    setCompanies(d.companies || []); setStores(d.stores || []);
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
    const { error } = await supabase.rpc("company_upsert", { p_client_id: clientId, p_id: null, p_name: name.trim(), p_npwp: npwp.trim() || null });
    if (error) return fail(error);
    setName(""); setNpwp(""); setMsg(null); load();
  }
  async function edit(c: Company) {
    const n = window.prompt("Company name", c.name);
    if (n === null) return;
    const t = window.prompt("NPWP (leave empty if none)", c.npwp || "");
    if (t === null) return;
    const { error } = await supabase.rpc("company_upsert", { p_client_id: clientId, p_id: c.id, p_name: n.trim() || c.name, p_npwp: t.trim() || null });
    if (error) return fail(error);
    setMsg(null); load();
  }
  async function del(c: Company) {
    if (!window.confirm(`Delete company ${c.name}? Its ${c.stores.length} store(s) stay, without a company.`)) return;
    const { error } = await supabase.rpc("company_delete", { p_id: c.id });
    if (error) return fail(error);
    setMsg(null); load();
  }
  async function assign(s: StoreRow, companyId: string) {
    const { error } = await supabase.rpc("company_set_store", { p_client_id: clientId, p_store: s.store_name, p_company: companyId || null });
    if (error) return fail(error);
    setMsg(null); load();
  }

  if (!isAdmin) return null;
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h3 style={{ margin: 0 }}>🏢 Companies</h3>
      <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 14px" }}>
        The company (tax entity) that owns the stores — Pajak is reported per company. One company can have many stores; <b>one store belongs to one company only</b>.
      </div>
      {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", marginBottom: 10, fontSize: 13 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(360px, 1.6fr)", gap: 18, alignItems: "start" }}>
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {companies.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(10,22,40,.55)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px" }}>
                <span style={{ flex: 1, fontSize: 13.5, minWidth: 0 }}>
                  {c.name} <span style={{ color: "var(--muted)" }}>· {c.stores.length} store{c.stores.length === 1 ? "" : "s"}</span>
                  {c.npwp && <div style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "monospace" }}>NPWP {c.npwp}</div>}
                </span>
                <button className="btn-ghost" onClick={() => edit(c)}>Edit</button>
                <button className="btn-ghost" onClick={() => del(c)} style={{ color: "#f87171" }}>Delete</button>
              </div>
            ))}
            {companies.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12.5, padding: "8px 2px" }}>No companies yet.</div>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 44px", gap: 8 }}>
            <input placeholder="Add company (PT …)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} style={field} />
            <input placeholder="NPWP (optional)" value={npwp} onChange={(e) => setNpwp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} style={field} />
            <button className="btn-gold" onClick={add} style={{ padding: 0 }}>+</button>
          </div>
        </div>
        <div className="tbl-wrap" style={{ maxHeight: 360 }}>
          <table className="tbl day-tbl">
            <thead><tr><th>Store name</th><th>City</th><th>Company</th></tr></thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.store_name}>
                  <td style={{ fontWeight: 600 }}>{s.store_name}</td>
                  <td style={{ color: "var(--muted)" }}>{s.city || "—"}</td>
                  <td>
                    <select value={s.company_id || ""} onChange={(e) => assign(s, e.target.value)}
                      style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${s.company_id ? "rgba(201,162,39,.35)" : "rgba(248,113,113,.5)"}`, background: "rgba(7,13,26,.85)", color: "#fff", minWidth: 200 }}>
                      <option value="">— no company —</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
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
