"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Item = { id: string; kind: string; value: string; pic: string | null; city: string | null };
type Client = { id: string; name: string };

export default function CoreListPage() {
  const [supabase] = useState(() => createClient());
  const [isSuper, setIsSuper] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState("");

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setItems([]); return; }
    const { data } = await supabase.from("master_data")
      .select("id,kind,value,pic,city").eq("client_id", cid).order("value");
    setItems((data as Item[]) || []);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("role,client_id").eq("id", user.id).single();
      const sup = p?.role === "superadmin";
      setIsSuper(sup);
      const { data: cs } = await supabase.from("clients").select("id,name").order("name");
      setClients((cs as Client[]) || []);
      const initial = sup ? ((cs as Client[])?.[0]?.id || "") : (p?.client_id || "");
      setClientId(initial);
      reload(initial);
    })();
  }, [supabase, reload]);

  const cities = items.filter((i) => i.kind === "city");
  const owners = items.filter((i) => i.kind === "owner");
  const stores = items.filter((i) => i.kind === "store");
  const brands = items.filter((i) => i.kind === "brand");
  const platforms = items.filter((i) => i.kind === "platform");

  async function add(kind: string, value: string, city?: string) {
    if (!clientId) { setMsg("Pick a client first"); return; }
    if (!value.trim()) return;
    setMsg("");
    const { error } = await supabase.from("master_data").insert({
      client_id: clientId, kind, value: value.trim(), city: city || null,
    });
    if (error) {
      setMsg(error.code === "23505" ? `"${value}" already exists in this list` : "✗ " + error.message);
      return;
    }
    reload(clientId);
  }
  async function remove(id: string) { await supabase.from("master_data").delete().eq("id", id); reload(clientId); }

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: "#fff", fontWeight: 800 }}>Core List</h2>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>Master data behind every dropdown — one city can have many owners &amp; stores.</div>
        </div>
        {isSuper && clients.length > 0 && (
          <div className="fld" style={{ minWidth: 180 }}>
            <label>Client</label>
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); reload(e.target.value); }}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {msg && <div style={{ color: "#ff9a9a", fontSize: 13, marginBottom: 12, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10, padding: "8px 12px" }}>{msg}</div>}

      <div className="core-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
        <Card icon="🏙️" title="Cities" count={cities.length}>
          <ItemList items={cities} onDel={remove} />
          <SimpleAdd placeholder="Add city…" onAdd={(v) => add("city", v)} />
        </Card>

        <Card icon="👤" title="Owners" count={owners.length}>
          <ItemList items={owners} sub={(i) => i.city} onDel={remove} />
          <LinkedAdd placeholder="Owner name…" cities={cities} onAdd={(v, c) => add("owner", v, c)} />
        </Card>

        <Card icon="🏬" title="Store Names" count={stores.length}>
          <ItemList items={stores} sub={(i) => i.city} onDel={remove} />
          <LinkedAdd placeholder="Store name…" cities={cities} onAdd={(v, c) => add("store", v, c)} />
        </Card>

        <Card icon="🏷️" title="Brands" count={brands.length}>
          <ItemList items={brands} onDel={remove} />
          <SimpleAdd placeholder="Add brand…" onAdd={(v) => add("brand", v)} />
        </Card>

        <Card icon="🛒" title="Platforms" count={platforms.length}>
          <ItemList items={platforms} onDel={remove} />
          <SimpleAdd placeholder="Add platform…" onAdd={(v) => add("platform", v)} />
        </Card>
      </div>
    </>
  );
}

/* ---------- premium card ---------- */
function Card({ icon, title, count, children }: { icon: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <h3 style={{ margin: 0, flex: 1 }}>{title}</h3>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "2px 10px" }}>{count}</span>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>{children}</div>
    </div>
  );
}

function ItemList({ items, sub, onDel }: { items: Item[]; sub?: (i: Item) => string | null; onDel: (id: string) => void }) {
  if (items.length === 0)
    return <div style={{ color: "var(--muted)", fontSize: 12.5, padding: "10px 4px", textAlign: "center" }}>No entries yet</div>;
  return (
    <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((i) => (
        <div key={i.id} className="core-row"
          style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(10,22,40,.55)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", transition: "border-color .15s" }}>
          <span style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{i.value}</span>
          {sub && sub(i) && <span style={{ fontSize: 11, color: "var(--gold)", background: "rgba(201,162,39,.1)", borderRadius: 6, padding: "2px 8px" }}>{sub(i)}</span>}
          <button onClick={() => onDel(i.id)} title="Remove"
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ff9a9a")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}>×</button>
        </div>
      ))}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(201,162,39,.22)",
  background: "rgba(10,22,40,.6)", color: "var(--text)", fontSize: 13, outline: "none",
};
const plusStyle: React.CSSProperties = {
  flexShrink: 0, width: 40, borderRadius: 10, border: "none", cursor: "pointer",
  background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", color: "var(--navy-deep)", fontWeight: 800, fontSize: 18,
};

function SimpleAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  const go = () => { if (v.trim()) { onAdd(v); setV(""); } };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
      <input style={{ ...fieldStyle, flex: 1 }} placeholder={placeholder} value={v}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button style={plusStyle} onClick={go}>+</button>
    </div>
  );
}

function LinkedAdd({ placeholder, cities, onAdd }: { placeholder: string; cities: Item[]; onAdd: (v: string, city: string) => void }) {
  const [v, setV] = useState(""); const [city, setCity] = useState("");
  const go = () => { if (v.trim() && city) { onAdd(v, city); setV(""); } };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
      <input style={{ ...fieldStyle, flex: 2, minWidth: 0 }} placeholder={placeholder} value={v}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <select style={{ ...fieldStyle, flex: 1, minWidth: 0, cursor: "pointer" }} value={city} onChange={(e) => setCity(e.target.value)}>
        <option value="">City…</option>
        {cities.map((c) => <option key={c.id} value={c.value}>{c.value}</option>)}
      </select>
      <button style={plusStyle} onClick={go} title={!city ? "Pick a city first" : "Add"}>+</button>
    </div>
  );
}
