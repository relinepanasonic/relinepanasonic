"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Company -> Vendor -> Store.
//   A company (tax entity, with its NPWP) has many vendors; a vendor has many stores; a store belongs to ONE vendor.
//   A store's company is its vendor's company, so moving a vendor to another company takes all its stores along.
type Company = { id: string; name: string; npwp: string | null };
type Vendor = { id: string; name: string; company_id: string | null; stores: string[] };
type StoreRow = { store_name: string; city: string | null; vendor_id: string | null };

const input: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(201,162,39,.22)", background: "rgba(10,22,40,.6)", color: "#e8edf8", fontSize: 13.5, minWidth: 0 };
const select: React.CSSProperties = { ...input, padding: "7px 10px", borderRadius: 8, fontSize: 12.5, background: "rgba(7,13,26,.85)" };
const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 11px", borderRadius: 999, fontSize: 12.5, background: "rgba(59,130,246,.12)", border: "1px solid rgba(59,130,246,.35)", color: "#cfe0ff" };
const link: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0, color: "var(--muted)" };

export default function StructurePanel({ clientId }: { clientId: string }) {
  const [supabase] = useState(() => createClient());
  const [companies, setCompanies] = useState<Company[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cName, setCName] = useState(""); const [cNpwp, setCNpwp] = useState("");
  const [vName, setVName] = useState(""); const [vCompany, setVCompany] = useState("");

  const load = useCallback(async () => {
    if (!clientId) return;
    const { data } = await supabase.rpc("company_list", { p_client_id: clientId });
    const d = (data as { companies: Company[]; vendors: Vendor[]; stores: StoreRow[] } | null) || { companies: [], vendors: [], stores: [] };
    setCompanies(d.companies || []); setVendors(d.vendors || []); setStores(d.stores || []);
  }, [supabase, clientId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) setMsg({ ok: false, text: error.message.replace(/^[A-Z_]+:\s*/, "") }); else { setMsg(null); load(); }
  };
  const free = useMemo(() => stores.filter((s) => !s.vendor_id), [stores]);   // stores that have no vendor yet

  const addCompany = async () => { if (!cName.trim()) return; await run(supabase.rpc("company_upsert", { p_client_id: clientId, p_id: null, p_name: cName.trim(), p_npwp: cNpwp.trim() || null })); setCName(""); setCNpwp(""); };
  const editCompany = (c: Company) => {
    const n = window.prompt("Company name", c.name); if (n === null) return;
    const t = window.prompt("NPWP (leave empty if none)", c.npwp || ""); if (t === null) return;
    run(supabase.rpc("company_upsert", { p_client_id: clientId, p_id: c.id, p_name: n.trim() || c.name, p_npwp: t.trim() || null }));
  };
  const delCompany = (c: Company) => { if (window.confirm(`Delete company ${c.name}? Its vendors stay (with their stores), without a company.`)) run(supabase.rpc("company_delete", { p_id: c.id })); };
  const addVendor = async () => {
    if (!vName.trim()) return;
    const { data, error } = await supabase.rpc("vendor_upsert", { p_client_id: clientId, p_id: null, p_name: vName.trim() });
    if (error) return setMsg({ ok: false, text: error.message.replace(/^[A-Z_]+:\s*/, "") });
    if (vCompany && data) await supabase.rpc("company_set_vendor", { p_client_id: clientId, p_vendor: data, p_company: vCompany });
    setVName(""); setVCompany(""); setMsg(null); load();
  };
  const renameVendor = (v: Vendor) => { const n = window.prompt("Vendor name", v.name); if (n && n.trim() !== v.name) run(supabase.rpc("vendor_upsert", { p_client_id: clientId, p_id: v.id, p_name: n.trim() })); };
  const delVendor = (v: Vendor) => { if (window.confirm(`Delete vendor ${v.name}? Its ${v.stores.length} store(s) stay, without a vendor.`)) run(supabase.rpc("vendor_delete", { p_id: v.id })); };
  const moveVendor = (v: Vendor, companyId: string) => run(supabase.rpc("company_set_vendor", { p_client_id: clientId, p_vendor: v.id, p_company: companyId || null }));
  const setStore = (store: string, vendorId: string | null) => run(supabase.rpc("vendor_set_store", { p_client_id: clientId, p_store: store, p_vendor: vendorId }));

  const VendorBox = ({ v }: { v: Vendor }) => (
    <div style={{ border: "1px solid var(--line)", background: "rgba(10,22,40,.55)", borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1, minWidth: 120 }}>🚚 {v.name}</span>
        <select value={v.company_id || ""} onChange={(e) => moveVendor(v, e.target.value)} style={select} title="Move this vendor (and its stores) to another company">
          <option value="">— no company —</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button style={link} onClick={() => renameVendor(v)}>Rename</button>
        <button style={{ ...link, color: "#f87171" }} onClick={() => delVendor(v)}>Delete</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {v.stores.map((s) => (
          <span key={s} style={chip}>🏬 {s}<button onClick={() => setStore(s, null)} title="Take this store out of the vendor" style={{ ...link, color: "#9fb4d8", fontSize: 14, padding: "0 4px" }}>×</button></span>
        ))}
        {v.stores.length === 0 && <span style={{ fontSize: 12, color: "#fbbf24" }}>no store yet</span>}
        <select value="" onChange={(e) => e.target.value && setStore(e.target.value, v.id)} style={{ ...select, maxWidth: 190 }} disabled={!free.length}>
          <option value="">{free.length ? "+ add a store" : "all stores are placed"}</option>
          {free.map((s) => <option key={s.store_name} value={s.store_name}>{s.store_name}</option>)}
        </select>
      </div>
    </div>
  );

  const loose = vendors.filter((v) => !v.company_id || !companies.some((c) => c.id === v.company_id));

  return (
    <div>
      {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", marginBottom: 12, fontSize: 13 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: "1 1 420px" }}>
          <input style={{ ...input, flex: "1 1 160px" }} placeholder="New company (PT …)" value={cName} onChange={(e) => setCName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCompany()} />
          <input style={{ ...input, flex: "1 1 140px" }} placeholder="NPWP (optional)" value={cNpwp} onChange={(e) => setCNpwp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCompany()} />
          <button className="btn-gold" onClick={addCompany} style={{ padding: "9px 18px" }}>+ Company</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: "1 1 420px" }}>
          <input style={{ ...input, flex: "1 1 160px" }} placeholder="New vendor" value={vName} onChange={(e) => setVName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addVendor()} />
          <select style={{ ...input, flex: "1 1 140px" }} value={vCompany} onChange={(e) => setVCompany(e.target.value)}>
            <option value="">under company…</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn-gold" onClick={addVendor} style={{ padding: "9px 18px" }}>+ Vendor</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 16, alignItems: "start" }}>
        {companies.map((c) => {
          const mine = vendors.filter((v) => v.company_id === c.id);
          return (
            <div key={c.id} className="panel" style={{ margin: 0 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>🏢 {c.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "monospace" }}>{c.npwp ? `NPWP ${c.npwp}` : "no NPWP"} · {mine.length} vendor{mine.length === 1 ? "" : "s"} · {mine.reduce((a, v) => a + v.stores.length, 0)} stores</div>
                </div>
                <button style={link} onClick={() => editCompany(c)}>Edit</button>
                <button style={{ ...link, color: "#f87171" }} onClick={() => delCompany(c)}>Delete</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {mine.map((v) => <VendorBox key={v.id} v={v} />)}
                {mine.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12.5, padding: "4px 2px" }}>No vendor yet — add one above, or move a vendor here.</div>}
              </div>
            </div>
          );
        })}

        {loose.length > 0 && (
          <div className="panel" style={{ margin: 0, borderStyle: "dashed" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#fbbf24", marginBottom: 4 }}>Vendors without a company</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Pick a company in the vendor&apos;s dropdown. Until then its stores appear only under “All companies” in Pajak.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{loose.map((v) => <VendorBox key={v.id} v={v} />)}</div>
          </div>
        )}

        {free.length > 0 && (
          <div className="panel" style={{ margin: 0, borderStyle: "dashed" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#fbbf24", marginBottom: 4 }}>Stores without a vendor</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>One store belongs to one vendor.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {free.map((s) => (
                <div key={s.store_name} style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--line)", padding: "6px 2px" }}>
                  <span style={{ flex: 1, fontSize: 13.5 }}>🏬 {s.store_name} <span style={{ color: "var(--muted)", fontSize: 12 }}>{s.city || ""}</span></span>
                  <select value="" onChange={(e) => e.target.value && setStore(s.store_name, e.target.value)} style={{ ...select, minWidth: 170 }}>
                    <option value="">{vendors.length ? "assign to vendor…" : "create a vendor first"}</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {companies.length === 0 && vendors.length === 0 && stores.length === 0 && <div style={{ color: "var(--muted)", padding: 24, textAlign: "center" }}>Nothing here yet. Add the store names first (Store names tab), then a company and its vendors.</div>}
    </div>
  );
}
