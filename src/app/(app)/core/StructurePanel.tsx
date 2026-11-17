"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Distributor -> Fulfillment center -> Dealer, one card per distributor (Light Solution and Alpha Project).
//   Database names: company -> vendor -> store (master_data kind 'store' + vendor_stores). Everything on screen uses the business words.
//   A fulfillment center belongs to ONE distributor, a dealer to ONE fulfillment center; moving a fulfillment center takes its dealers along.
//   Dealers are created right here (the name is what the Shopee data is matched on), so there is no separate list to fill first.
type Company = { id: string; name: string; npwp: string | null };
type Vendor = { id: string; name: string; company_id: string | null; stores: string[] };
type StoreRow = { store_name: string; city: string | null; vendor_id: string | null };
type EditState = { kind: "company" | "vendor"; id: string } | null;

const LEVEL = { dist: "#14b8a6", ful: "#f97316", dealer: "#60a5fa" };
// the database speaks of vendors, companies and stores: say it the way the business does
const plain = (m: string) => m.replace(/^[A-Z_]+:\s*/, "").replace(/\bvendors\b/gi, "fulfillment centers").replace(/\bvendor\b/gi, "fulfillment center").replace(/\bcompany\b/gi, "distributor").replace(/\bstores\b/gi, "dealers").replace(/\bstore\b/gi, "dealer");

const CSS = `
.cn-in{padding:9px 12px;border-radius:10px;border:1px solid rgba(201,162,39,.25);background:rgba(10,22,40,.6);color:#e8edf8;font-size:13.5px;min-width:0}
.cn-in:focus-visible,.cn-btn:focus-visible,.cn-sel:focus-visible,.cn-chip button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.cn-sel{padding:6px 10px;border-radius:8px;border:1px solid rgba(201,162,39,.22);background:rgba(7,13,26,.85);color:#e8edf8;font-size:12.5px;max-width:200px}
.cn-btn{background:none;border:none;cursor:pointer;font-size:12.5px;padding:3px 6px;border-radius:6px;color:var(--muted)}
.cn-btn:hover{color:#e8edf8;background:rgba(255,255,255,.06)}
.cn-btn.danger:hover{color:#ff9a9a;background:rgba(239,68,68,.1)}
.cn-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 4px 4px 11px;border-radius:999px;font-size:12.5px;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.35);color:#dbe7ff}
.cn-chip button{background:none;border:none;cursor:pointer;color:#8aa6d6;font-size:15px;line-height:1;padding:0 6px;border-radius:999px}
.cn-chip button:hover{color:#ff9a9a}
.cn-card{border:1px solid var(--line);border-radius:14px;background:rgba(13,26,54,.55);margin-bottom:16px;overflow:hidden}
.cn-ful{margin:0 0 10px 18px;padding:12px 14px;border-left:3px solid ${LEVEL.ful};background:rgba(10,22,40,.5);border-radius:0 10px 10px 0}
@media (max-width:640px){.cn-ful{margin-left:6px}}
`;

export default function StructurePanel({ clientId }: { clientId: string }) {
  const [supabase] = useState(() => createClient());
  const [companies, setCompanies] = useState<Company[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cName, setCName] = useState(""); const [cNpwp, setCNpwp] = useState("");
  const [newVendor, setNewVendor] = useState<Record<string, string>>({});     // per distributor: the new fulfillment center name
  const [newDealer, setNewDealer] = useState<Record<string, string>>({});     // per fulfillment center: the new dealer name
  const [edit, setEdit] = useState<EditState>(null); const [eName, setEName] = useState(""); const [eNpwp, setENpwp] = useState("");

  const load = useCallback(async () => {
    if (!clientId) return;
    const { data } = await supabase.rpc("company_list", { p_client_id: clientId });
    const d = (data as { companies: Company[]; vendors: Vendor[]; stores: StoreRow[] } | null) || { companies: [], vendors: [], stores: [] };
    setCompanies(d.companies || []); setVendors(d.vendors || []); setStores(d.stores || []); setLoaded(true);
  }, [supabase, clientId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const ok = (text: string) => setMsg({ ok: true, text });
  const fail = (text: string) => setMsg({ ok: false, text: plain(text) });
  const run = async (p: PromiseLike<{ error: { message: string } | null }>, done?: string) => {
    const { error } = await p;
    if (error) { fail(error.message); return false; }
    if (done) ok(done); else setMsg(null);
    await load(); return true;
  };
  const free = useMemo(() => stores.filter((s) => !s.vendor_id), [stores]);                 // dealers without a fulfillment center
  const looseVendors = useMemo(() => vendors.filter((v) => !v.company_id || !companies.some((c) => c.id === v.company_id)), [vendors, companies]);
  const dealerCount = stores.filter((s) => s.vendor_id).length;

  const addCompany = async () => {
    if (!cName.trim()) return;
    if (await run(supabase.rpc("company_upsert", { p_client_id: clientId, p_id: null, p_name: cName.trim(), p_npwp: cNpwp.trim() || null }), `Distributor "${cName.trim()}" added. Now add its fulfillment centers.`)) { setCName(""); setCNpwp(""); }
  };
  const addVendor = async (companyId: string, companyName: string) => {
    const name = (newVendor[companyId] || "").trim(); if (!name) return;
    const { data, error } = await supabase.rpc("vendor_upsert", { p_client_id: clientId, p_id: null, p_name: name });
    if (error) return fail(error.message);
    if (data) await supabase.rpc("company_set_vendor", { p_client_id: clientId, p_vendor: data, p_company: companyId });
    setNewVendor((m) => ({ ...m, [companyId]: "" })); ok(`Fulfillment center "${name}" added to ${companyName}. Now add its dealers.`); load();
  };
  const addDealer = async (v: Vendor) => {
    const name = (newDealer[v.id] || "").trim(); if (!name) return;
    const known = stores.find((s) => s.store_name.toLowerCase() === name.toLowerCase());
    if (known?.vendor_id && known.vendor_id !== v.id) {
      const owner = vendors.find((x) => x.id === known.vendor_id)?.name || "another fulfillment center";
      return fail(`"${known.store_name}" already belongs to ${owner}. A dealer has only one fulfillment center: remove it there first.`);
    }
    if (known?.vendor_id === v.id) return fail(`"${known.store_name}" is already in ${v.name}.`);
    if (!known) {
      const { error } = await supabase.from("master_data").insert({ client_id: clientId, kind: "store", value: name });
      if (error) return fail(error.code === "23505" ? `"${name}" already exists.` : error.message);
    }
    if (await run(supabase.rpc("vendor_set_store", { p_client_id: clientId, p_store: known?.store_name || name, p_vendor: v.id }), `Dealer "${known?.store_name || name}" added to ${v.name}.`)) setNewDealer((m) => ({ ...m, [v.id]: "" }));
  };
  const deleteDealer = async (s: StoreRow) => {
    if (!window.confirm(`Delete the dealer "${s.store_name}"? Its uploaded data stays, but the name disappears from the lists.`)) return;
    await run(supabase.from("master_data").delete().eq("client_id", clientId).eq("kind", "store").eq("value", s.store_name), `Dealer "${s.store_name}" deleted.`);
  };
  const setDealerVendor = (store: string, vendorId: string | null, done?: string) => run(supabase.rpc("vendor_set_store", { p_client_id: clientId, p_store: store, p_vendor: vendorId }), done);
  const moveVendor = (v: Vendor, companyId: string) => run(supabase.rpc("company_set_vendor", { p_client_id: clientId, p_vendor: v.id, p_company: companyId || null }), companyId ? `${v.name} moved, with its dealers.` : undefined);
  const delCompany = (c: Company) => { if (window.confirm(`Delete the distributor "${c.name}"? Its fulfillment centers and their dealers stay, but without a distributor.`)) run(supabase.rpc("company_delete", { p_id: c.id }), `Distributor "${c.name}" deleted.`); };
  const delVendor = (v: Vendor) => { if (window.confirm(`Delete the fulfillment center "${v.name}"? Its ${v.stores.length} dealer${v.stores.length === 1 ? "" : "s"} stay, but without a fulfillment center.`)) run(supabase.rpc("vendor_delete", { p_id: v.id }), `Fulfillment center "${v.name}" deleted.`); };

  const startEdit = (kind: "company" | "vendor", id: string, name: string, npwp?: string | null) => { setEdit({ kind, id }); setEName(name); setENpwp(npwp || ""); };
  const saveEdit = async () => {
    if (!edit || !eName.trim()) return;
    const done = edit.kind === "company"
      ? await run(supabase.rpc("company_upsert", { p_client_id: clientId, p_id: edit.id, p_name: eName.trim(), p_npwp: eNpwp.trim() || null }), "Saved.")
      : await run(supabase.rpc("vendor_upsert", { p_client_id: clientId, p_id: edit.id, p_name: eName.trim() }), "Saved.");
    if (done) setEdit(null);
  };

  const hasDist = companies.length > 0, hasFul = vendors.length > 0, hasDealer = dealerCount > 0;
  const steps = [
    { done: hasDist, l: "Add a distributor", hint: "Type the distributor's name below, for example the PT that buys from Panasonic." },
    { done: hasFul, l: "Add its fulfillment centers", hint: "Open the distributor card and add the fulfillment centers it works with." },
    { done: hasDealer, l: "Add the dealers", hint: "Inside a fulfillment center, type a dealer name (the Shopee shop) and press Enter." },
  ];
  const current = steps.findIndex((s) => !s.done);

  // a function that returns the row (not a component), so typing does not lose the focus on every key
  const editRow = (npwp?: boolean) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", flex: 1 }}>
      <input className="cn-in" autoFocus value={eName} onChange={(e) => setEName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEdit(null); }} aria-label="Name" style={{ flex: "1 1 200px" }} />
      {npwp && <input className="cn-in" value={eNpwp} onChange={(e) => setENpwp(e.target.value)} placeholder="NPWP (optional)" onKeyDown={(e) => e.key === "Enter" && saveEdit()} aria-label="NPWP" style={{ flex: "0 1 170px" }} />}
      <button className="btn-gold" onClick={saveEdit} style={{ padding: "7px 16px", fontSize: 13 }}>Save</button>
      <button className="cn-btn" onClick={() => setEdit(null)}>Cancel</button>
    </div>
  );

  const vendorBlock = (v: Vendor) => (
    <div key={v.id} className="cn-ful">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {edit?.kind === "vendor" && edit.id === v.id ? editRow() : (
          <>
            <span aria-hidden>🚚</span>
            <b style={{ fontSize: 14.5, color: "#fff" }}>{v.name}</b>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{v.stores.length} dealer{v.stores.length === 1 ? "" : "s"}</span>
            <span style={{ flex: 1 }} />
            <select className="cn-sel" value={v.company_id || ""} onChange={(e) => moveVendor(v, e.target.value)} aria-label={`Distributor of ${v.name}`}>
              <option value="">{v.company_id ? "No distributor" : "Choose a distributor…"}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="cn-btn" onClick={() => startEdit("vendor", v.id, v.name)}>Rename</button>
            <button className="cn-btn danger" onClick={() => delVendor(v)}>Delete</button>
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {v.stores.map((s) => (
          <span key={s} className="cn-chip">{s}<button onClick={() => setDealerVendor(s, null, `"${s}" removed from ${v.name}. It is in "Dealers without a fulfillment center" below.`)} aria-label={`Remove ${s} from ${v.name}`} title={`Remove from ${v.name}`}>×</button></span>
        ))}
        <input className="cn-in" value={newDealer[v.id] || ""} onChange={(e) => setNewDealer((m) => ({ ...m, [v.id]: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && addDealer(v)} placeholder={v.stores.length ? "Add another dealer" : "Add the first dealer: type its name, press Enter"}
          aria-label={`New dealer for ${v.name}`} style={{ flex: "1 1 240px", maxWidth: 380, padding: "6px 11px", fontSize: 13 }} />
        {(newDealer[v.id] || "").trim() && <button className="btn-gold" onClick={() => addDealer(v)} style={{ padding: "6px 14px", fontSize: 12.5 }}>Add dealer</button>}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 980 }}>
      <style>{CSS}</style>

      {msg && (
        <div role="status" style={{ marginBottom: 14, padding: "9px 14px", borderRadius: 10, fontSize: 13.5, display: "flex", gap: 10, alignItems: "center",
          color: msg.ok ? "#9bf0c4" : "#ffb4b4", background: msg.ok ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)", border: "1px solid " + (msg.ok ? "rgba(34,197,94,.3)" : "rgba(239,68,68,.3)") }}>
          <span style={{ flex: 1 }}>{msg.text}</span><button className="cn-btn" onClick={() => setMsg(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {loaded && current !== -1 && (
        <div style={{ marginBottom: 18, padding: "14px 16px", borderRadius: 12, border: "1px dashed rgba(201,162,39,.4)", background: "rgba(201,162,39,.05)" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
            {steps.map((s, i) => (
              <span key={s.l} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: i === current ? 800 : 600, color: s.done ? "#9bf0c4" : i === current ? "var(--gold)" : "var(--muted)" }}>
                <span style={{ width: 20, height: 20, borderRadius: 999, display: "inline-grid", placeItems: "center", fontSize: 11, fontWeight: 800, border: "1.5px solid currentColor" }}>{s.done ? "✓" : i + 1}</span>
                {s.l}{i < steps.length - 1 && <span style={{ color: "var(--muted)", marginLeft: 4 }}>›</span>}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2, #c9d4ea)" }}>{steps[current].hint}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
        <input className="cn-in" value={cName} onChange={(e) => setCName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCompany()} placeholder="Distributor name, for example PT Simbarco Kencana" aria-label="New distributor" style={{ flex: "1 1 300px" }} />
        <input className="cn-in" value={cNpwp} onChange={(e) => setCNpwp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCompany()} placeholder="NPWP (optional)" aria-label="NPWP" style={{ flex: "0 1 180px" }} />
        <button className="btn-gold" onClick={addCompany} disabled={!cName.trim()} style={{ padding: "9px 22px" }}>Add distributor</button>
      </div>

      {companies.map((c) => {
        const mine = vendors.filter((v) => v.company_id === c.id);
        const nDealers = mine.reduce((a, v) => a + v.stores.length, 0);
        return (
          <section key={c.id} className="cn-card" aria-label={`Distributor ${c.name}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "14px 16px", borderBottom: "1px solid var(--line)", borderLeft: `4px solid ${LEVEL.dist}` }}>
              {edit?.kind === "company" && edit.id === c.id ? editRow(true) : (
                <>
                  <span aria-hidden style={{ fontSize: 20 }}>🏢</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {mine.length} fulfillment center{mine.length === 1 ? "" : "s"} · {nDealers} dealer{nDealers === 1 ? "" : "s"}{c.npwp ? ` · NPWP ${c.npwp}` : ""}
                    </div>
                  </div>
                  <span style={{ flex: 1 }} />
                  <button className="cn-btn" onClick={() => startEdit("company", c.id, c.name, c.npwp)}>Rename</button>
                  <button className="cn-btn danger" onClick={() => delCompany(c)}>Delete</button>
                </>
              )}
            </div>
            <div style={{ padding: "14px 16px 6px" }}>
              {mine.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>No fulfillment center yet. Add the first one below.</div>}
              {mine.map(vendorBlock)}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "4px 0 10px 18px" }}>
                <input className="cn-in" value={newVendor[c.id] || ""} onChange={(e) => setNewVendor((m) => ({ ...m, [c.id]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addVendor(c.id, c.name)}
                  placeholder={`New fulfillment center of ${c.name}`} aria-label={`New fulfillment center of ${c.name}`} style={{ flex: "1 1 260px", maxWidth: 380 }} />
                <button className="btn-gold" onClick={() => addVendor(c.id, c.name)} disabled={!(newVendor[c.id] || "").trim()} style={{ padding: "8px 18px", fontSize: 13 }}>Add fulfillment center</button>
              </div>
            </div>
          </section>
        );
      })}

      {looseVendors.length > 0 && (
        <section className="cn-card" aria-label="Fulfillment centers without a distributor">
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", borderLeft: "4px solid #f59e0b" }}>
            <div style={{ fontWeight: 800, color: "#fff" }}>Fulfillment centers without a distributor</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Choose a distributor for each one. Its dealers move along.</div>
          </div>
          <div style={{ padding: "14px 16px 4px" }}>{looseVendors.map(vendorBlock)}</div>
        </section>
      )}

      {free.length > 0 && (
        <section className="cn-card" aria-label="Dealers without a fulfillment center">
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", borderLeft: "4px solid #f59e0b" }}>
            <div style={{ fontWeight: 800, color: "#fff" }}>Dealers without a fulfillment center</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Each dealer belongs to one fulfillment center. Pick it here, or delete a dealer you do not need.</div>
          </div>
          <div style={{ padding: "10px 16px 14px", display: "grid", gap: 8 }}>
            {free.map((s) => (
              <div key={s.store_name} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="cn-chip" style={{ paddingRight: 11 }}>{s.store_name}</span>
                <select className="cn-sel" value="" onChange={(e) => e.target.value && setDealerVendor(s.store_name, e.target.value, `"${s.store_name}" linked.`)} aria-label={`Fulfillment center of ${s.store_name}`} disabled={vendors.length === 0}>
                  <option value="">{vendors.length ? "Choose a fulfillment center…" : "Add a fulfillment center first"}</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <button className="cn-btn danger" onClick={() => deleteDealer(s)}>Delete dealer</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {loaded && companies.length === 0 && looseVendors.length === 0 && free.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "28px 10px", fontSize: 13.5 }}>Nothing here yet. Start with the distributor above.</div>
      )}
    </div>
  );
}
