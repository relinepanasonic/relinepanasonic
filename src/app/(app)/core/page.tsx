"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { isPageHidden } from "@/lib/workspace";
import { useWorkspaceId } from "@/lib/useWorkspace";
import StructurePanel from "./StructurePanel";

export const dynamic = "force-dynamic";

// Connector: the links and lists behind every dropdown.
//   Company · Vendor · Store  (workspaces with Payout, Super Admin / Admin): a company has vendors, a vendor has stores,
//                              a store belongs to one vendor; moving a vendor takes its stores along.
//   City & PIC · Store names / Dealers · Brands · Product types   the master lists.
type Item = { id: string; kind: string; value: string; pic: string | null; city: string | null };
type Tab = "structure" | "city" | "store" | "brand" | "type";

export default function ConnectorPage() {
  const [supabase] = useState(() => createClient());
  const workspaceId = useWorkspaceId();
  const hasStructure = !isPageHidden(workspaceId, "/payout"); // workspaces with Payout: dealers are "Store names", plus Company / Vendor
  const [clientId, setClientId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<Tab | null>(null);

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setItems([]); return; }
    const { data } = await supabase.from("master_data").select("id,kind,value,pic,city").eq("client_id", cid).order("value");
    setItems((data as Item[]) || []);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: cs }, { data: p }] = await Promise.all([
        supabase.from("clients").select("id").order("created_at").limit(1),
        supabase.from("profiles").select("role").eq("id", user.id).single(),
      ]);
      const initial = (cs as { id: string }[])?.[0]?.id || "";
      setClientId(initial);
      setIsAdmin(["superadmin", "client_admin"].includes((p as { role?: string } | null)?.role || ""));
      reload(initial);
    })();
  }, [supabase, reload]);

  const cities  = items.filter((i) => i.kind === "city");
  const dealers = items.filter((i) => i.kind === "store");   // 'store' since migration 0004
  const brands  = items.filter((i) => i.kind === "brand");
  const types   = items.filter((i) => i.kind === "platform"); // 'platform' since migration 0004
  const picOfCity = (city: string) => cities.find((c) => c.value === city)?.pic || null;

  async function insertRow(row: Record<string, unknown>) {
    if (!clientId) { setMsg("Workspace not ready — refresh the page"); return; }
    setMsg("");
    const { error } = await supabase.from("master_data").insert({ client_id: clientId, ...row });
    if (error) { setMsg(error.code === "23505" ? `"${row.value}" already exists` : "✗ " + error.message); return; }
    reload(clientId);
  }
  async function delItem(id: string) { await supabase.from("master_data").delete().eq("id", id); reload(clientId); }

  const showStructure = hasStructure && isAdmin;
  const tabs: { v: Tab; l: string; n?: number }[] = [
    ...(showStructure ? [{ v: "structure" as Tab, l: "Company · Vendor · Store" }] : []),
    { v: "city", l: "City & PIC", n: cities.length },
    { v: "store", l: hasStructure ? "Store names" : "Dealers", n: dealers.length },
    { v: "brand", l: "Brands", n: brands.length },
    { v: "type", l: "Product types", n: types.length },
  ];
  const active: Tab = tab && tabs.some((t) => t.v === tab) ? tab : tabs[0].v;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 22 }}>Connector</h3>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
          {showStructure
            ? "Who owns what: Company → Vendor → Store. Plus the lists behind every dropdown (City, PIC, Store names, Brand, Product type)."
            : "The lists behind every dropdown — City, PIC, Dealer, Brand & Product Type — used across Upload, Invites and filters."}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t.v} onClick={() => setTab(t.v)} style={tabBtn(active === t.v)}>
            {t.l}{t.n !== undefined && <span style={{ marginLeft: 8, fontSize: 11.5, opacity: .75 }}>{t.n}</span>}
          </button>
        ))}
      </div>

      {msg && <div style={{ color: "#ff9a9a", fontSize: 13, marginBottom: 12, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 8, padding: "8px 12px" }}>{msg}</div>}

      {active === "structure" && <StructurePanel clientId={clientId} />}

      {active === "city" && (
        <ListCard
          rows={cities.map((c) => ({ id: c.id, main: c.value, sub: c.pic ? `PIC ${c.pic}` : null }))} onDel={delItem}
          hint="1 city = 1 PIC Panasonic"
          add={<CityAdd onAdd={(city, pic) => insertRow({ kind: "city", value: city, pic: pic || null })} />}
        />
      )}
      {active === "store" && (
        <ListCard
          rows={dealers.map((d) => ({ id: d.id, main: d.value, sub: [d.city, d.pic].filter(Boolean).join(" · ") || null }))} onDel={delItem}
          hint={hasStructure ? "The store names (Shopee shops). Link each one to a vendor in the Company · Vendor · Store tab." : "The dealers."}
          add={<DealerAdd label={hasStructure ? "Store name" : "Dealer name"} cities={cities.map((c) => c.value)} picOfCity={picOfCity}
                 onAdd={(name, city) => insertRow({ kind: "store", value: name, city: city || null, pic: picOfCity(city) })} />}
        />
      )}
      {active === "brand" && (
        <ListCard rows={brands.map((b) => ({ id: b.id, main: b.value, sub: null }))} onDel={delItem}
          add={<SimpleAdd placeholder="Add brand" onAdd={(v) => insertRow({ kind: "brand", value: v })} />} />
      )}
      {active === "type" && (
        <ListCard rows={types.map((t) => ({ id: t.id, main: t.value, sub: null }))} onDel={delItem}
          add={<SimpleAdd placeholder="Add product type" onAdd={(v) => insertRow({ kind: "platform", value: v })} />} />
      )}
    </>
  );
}

/* ---------- one tidy list: add form on top, rows below ---------- */
function ListCard({ rows, onDel, add, hint }: { rows: { id: string; main: string; sub: string | null }[]; onDel: (id: string) => void; add: React.ReactNode; hint?: string }) {
  return (
    <div className="panel" style={{ margin: 0, maxWidth: 900 }}>
      {hint && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>{hint}</div>}
      <div style={{ marginBottom: 14 }}>{add}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
        {rows.map((r) => (
          <div key={r.id} style={rowStyle}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>
              {r.main}{r.sub ? <span style={{ color: "var(--muted)", fontSize: 12 }}> · {r.sub}</span> : null}
            </span>
            <button onClick={() => onDel(r.id)} title="Remove" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 17, lineHeight: 1, padding: "0 2px" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ff9a9a")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}>×</button>
          </div>
        ))}
      </div>
      {rows.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12.5, padding: "10px 4px" }}>No entries yet</div>}
    </div>
  );
}

function CityAdd({ onAdd }: { onAdd: (city: string, pic: string) => void }) {
  const [city, setCity] = useState(""); const [pic, setPic] = useState("");
  const go = () => { if (city.trim()) { onAdd(city.trim(), pic.trim()); setCity(""); setPic(""); } };
  return (
    <div style={addRow}>
      <input style={{ ...fieldStyle, flex: "1 1 180px" }} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <input style={{ ...fieldStyle, flex: "1 1 180px" }} placeholder="PIC for this city" value={pic} onChange={(e) => setPic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button className="btn-gold" onClick={go} style={{ padding: "9px 20px" }}>+ Add</button>
    </div>
  );
}

function DealerAdd({ label, cities, picOfCity, onAdd }: { label: string; cities: string[]; picOfCity: (c: string) => string | null; onAdd: (name: string, city: string) => void }) {
  const [name, setName] = useState(""); const [city, setCity] = useState("");
  const go = () => { if (name.trim()) { onAdd(name.trim(), city); setName(""); setCity(""); } };
  return (
    <div style={addRow}>
      <input style={{ ...fieldStyle, flex: "1 1 200px" }} placeholder={label} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <select style={{ ...fieldStyle, flex: "1 1 160px" }} value={city} onChange={(e) => setCity(e.target.value)}>
        <option value="">Select city</option>
        {cities.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input style={{ ...fieldStyle, flex: "1 1 130px" }} placeholder="PIC (auto)" value={city ? (picOfCity(city) || "") : ""} disabled />
      <button className="btn-gold" onClick={go} style={{ padding: "9px 20px" }}>+ Add</button>
    </div>
  );
}

function SimpleAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  const go = () => { if (v.trim()) { onAdd(v.trim()); setV(""); } };
  return (
    <div style={addRow}>
      <input style={{ ...fieldStyle, flex: "1 1 260px" }} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button className="btn-gold" onClick={go} style={{ padding: "9px 20px" }}>+ Add</button>
    </div>
  );
}

const tabBtn = (on: boolean): React.CSSProperties => ({
  padding: "9px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700,
  border: on ? "1px solid var(--gold)" : "1px solid rgba(255,255,255,.1)",
  background: on ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
  color: on ? "var(--navy-deep)" : "#e8edf8",
});
const addRow: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, background: "rgba(10,22,40,.55)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px" };
const fieldStyle: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(201,162,39,.22)", background: "rgba(10,22,40,.6)", color: "var(--text,#e8edf8)", fontSize: 13.5, minWidth: 0 };
