"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { Modal } from "@/components/ProductCatalog";
import { PLATFORMS, cleanUrl, detectPlatform, type Platform } from "@/lib/priceResearch";

// Price Research > Product URL: the log of store connections first (SRP ID | Catalog ID | Store | products with a URL), then one connection:
// every product of the SRP in one table, with our Harga Jual and the Product URL of that store. A store may not sell every product: a product
// without URL is simply not connected. Save puts the URLs in the log; then another store can be connected to the same SRP. Scraping is in Price Guard.
type Supabase = ReturnType<typeof createClient>;
type Store = { id: string; name: string };
type ConnLog = {
  id: string; srp_id: string | null; srp_no: string | null; catalog_no: string | null; vendor_name: string | null; store_id: string | null; store_name: string | null; platform: string | null;
  created_at: string; created_by: string | null; products: number; connected: number; platforms: Platform[];
};
type ConnProduct = {
  prod_id: string; product_name: string; price: { shopee: number | null; tiktok: number | null; any: number | null };
  link: { id: string; product_url: string; platform: Platform } | null;
};
type SrpOption = { id: string; srp_no: string; catalog_no: string | null; vendor_name: string | null; created_at: string; total_sku: number };

const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.v, p.label])) as Record<Platform, string>;
const rp = (n: number | null | undefined) => (n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function dmy(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v); if (Number.isNaN(d.getTime())) return "—";
  const j = new Date(d.getTime() + 7 * 3600_000);
  return `${String(j.getUTCDate()).padStart(2, "0")} ${MON[j.getUTCMonth()]} ${j.getUTCFullYear()}`;
}
// which kinds of links a connection accepts: a Shopee connection only Shopee links, a Tiktok Tokped one Tokopedia / TikTok Shop links
function allowedPlatforms(conn: { platform: string | null }): Platform[] | null {
  const p = (conn.platform || "").toLowerCase();
  if (p.startsWith("shopee")) return ["shopee"];
  if (p.startsWith("tiktok") || p.startsWith("tokopedia")) return ["tokopedia", "tiktok"];
  return null;
}
// our selling price to compare with this URL's marketplace: the price of the SRP line of that marketplace, else the lowest one of the product
function ourPrice(p: ConnProduct, platform: Platform | null, fixed: boolean): number | null {
  if (fixed) return p.price.any;
  const key = platform === "shopee" ? "shopee" : platform ? "tiktok" : null;
  return (key ? p.price[key] : null) ?? p.price.any;
}

export default function StoreConnections({ supabase, clientId, isAdmin, tick, onChanged }: {
  supabase: Supabase; clientId: string; isAdmin: boolean; tick: number; onChanged: () => void;
}) {
  const [log, setLog] = useState<ConnLog[] | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [usage, setUsage] = useState<{ store_id: string | null }[]>([]);
  const [open, setOpen] = useState<ConnLog | null>(null);
  const [creating, setCreating] = useState(false);
  const [manage, setManage] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [{ data: l }, { data: s }, { data: u }] = await Promise.all([
      supabase.rpc("pr_connections_log", { p_client_id: clientId }),
      supabase.from("pr_stores").select("id, name").eq("client_id", clientId).order("name"),
      supabase.from("price_research_links").select("store_id").eq("client_id", clientId),
    ]);
    setLog((l as ConnLog[]) || []); setStores((s as Store[]) || []); setUsage((u as { store_id: string | null }[]) || []);
  }, [supabase, clientId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, tick]);

  async function openById(id: string) {
    const { data } = await supabase.rpc("pr_connections_log", { p_client_id: clientId });
    const rows = (data as ConnLog[]) || [];
    setLog(rows);
    const c = rows.find((x) => x.id === id);
    if (c) { setMsg(null); setOpen(c); }
  }

  if (open) {
    return (
      <ConnectionEditor supabase={supabase} clientId={clientId} isAdmin={isAdmin} conn={open}
        onBack={() => { setOpen(null); load(); }}
        onDone={(text) => { setOpen(null); setMsg({ ok: true, text }); load(); onChanged(); }} />
    );
  }

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div className="hint" style={{ flex: 1, margin: 0 }}>Each row connects an SRP (and its Catalog) to one competitor store. Open a row to paste the Product URL of every product in that store, or press <b>Connect new store</b>.</div>
        {isAdmin && <button className="btn-ghost" onClick={() => setManage(true)}>Stores ({stores.length})</button>}
        {isAdmin && <button className="btn-gold" onClick={() => setCreating(true)} style={{ padding: "10px 22px" }}>+ Connect new store</button>}
      </div>
      {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", fontSize: 13, marginBottom: 10 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}
      {log === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "66vh" }}>
          <table className="tbl day-tbl">
            <thead><tr><th>SRP ID</th><th>Catalog ID</th><th>Store Name</th><th>Platform</th><th className="num">Products connected</th><th>Date Create</th><th>Created by</th></tr></thead>
            <tbody>
              {log.map((c) => (
                <tr key={c.id} onClick={() => { setMsg(null); setOpen(c); }} style={{ cursor: "pointer" }}>
                  <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{c.srp_no || <span style={{ color: "var(--muted)", fontWeight: 400 }}>— (older links)</span>}</td>
                  <td><span style={{ fontFamily: "monospace" }}>{c.catalog_no || "—"}</span>{c.vendor_name && <span style={{ color: "var(--muted)", fontSize: 12 }}> · {c.vendor_name}</span>}</td>
                  <td style={{ fontWeight: 700 }}>{c.store_name || "—"}</td>
                  <td>{c.platform || (c.platforms.length ? c.platforms.map((p) => PLATFORM_LABEL[p]).join(", ") : <span style={{ color: "var(--muted)" }}>—</span>)}</td>
                  <td className="num"><b>{c.connected}</b> <span style={{ color: "var(--muted)" }}>of {c.products}</span></td>
                  <td>{dmy(c.created_at)}</td>
                  <td>{c.created_by || "—"}</td>
                </tr>
              ))}
              {log.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No store connected yet — press + Connect new store, pick an SRP and a store.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewConnectionModal supabase={supabase} clientId={clientId} stores={stores} onStores={setStores}
        onClose={(id) => { setCreating(false); if (id) openById(id); }} />}
      {manage && <StoresModal supabase={supabase} clientId={clientId} stores={stores} links={usage} onClose={() => { setManage(false); load(); onChanged(); }} />}
    </>
  );
}

/* ── + Connect new store: which SRP, which store ── */
function NewConnectionModal({ supabase, clientId, stores, onStores, onClose }: {
  supabase: Supabase; clientId: string; stores: Store[]; onStores: (s: Store[]) => void; onClose: (newId: string | null) => void;
}) {
  const [srps, setSrps] = useState<SrpOption[] | null>(null);
  const [srpId, setSrpId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [platform, setPlatform] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("calc_srp_log", { p_client_id: clientId });
      const l = (data as SrpOption[]) || [];
      setSrps(l); setSrpId(l[0]?.id || "");
    })();
  }, [supabase, clientId]);
  // the platforms the lines of the chosen SRP are made for (Shopee, Tiktok Tokped ...)
  useEffect(() => {
    if (!srpId) return;
    (async () => {
      const { data } = await supabase.from("massive_calc_rows").select("fee_platform").eq("srp_id", srpId).not("fee_platform", "is", null);
      const list = [...new Set(((data as { fee_platform: string }[]) || []).map((r) => r.fee_platform).filter(Boolean))].sort();
      setPlatforms(list); setPlatform(list[0] || "");
    })();
  }, [supabase, srpId]);

  async function pickStore(v: string) {
    if (v !== "__new") { setStoreId(v); return; }
    const name = window.prompt("New store name")?.trim();
    if (!name) return;
    const have = stores.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (have) { setStoreId(have.id); return; }
    const { data, error } = await supabase.from("pr_stores").insert({ client_id: clientId, name }).select("id, name").single();
    if (error) { setErr(error.message); return; }
    onStores([...stores, data as Store].sort((a, b) => a.name.localeCompare(b.name)));
    setStoreId((data as Store).id);
  }
  async function create() {
    setErr("");
    if (!srpId) { setErr("Pick the SRP."); return; }
    if (!storeId) { setErr("Pick the store (or add a new one in the dropdown)."); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("pr_connection_create", { p_client_id: clientId, p_srp_id: srpId, p_store_id: storeId, p_platform: platform || null });
    setSaving(false);
    if (error) { setErr(error.message.replace(/^[A-Z_]+:\s*/, "")); return; }
    onClose(data as string);
  }
  return (
    <Modal onClose={() => onClose(null)} width={720}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Connect new store</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>Pick the SRP whose products you compare, and the competitor store. The next screen lists every product of the SRP for that platform, ready for the Product URLs.</div>
      {srps === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "34vh" }}>
          <table className="tbl">
            <thead><tr><th style={{ width: 34 }}></th><th>SRP ID</th><th>Catalog ID</th><th>Date Create</th><th className="num">Total SKU</th></tr></thead>
            <tbody>
              {srps.map((s) => (
                <tr key={s.id} onClick={() => setSrpId(s.id)} style={{ cursor: "pointer" }}>
                  <td><input type="radio" checked={srpId === s.id} onChange={() => setSrpId(s.id)} /></td>
                  <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{s.srp_no}</td>
                  <td><span style={{ fontFamily: "monospace" }}>{s.catalog_no || "—"}</span>{s.vendor_name && <span style={{ color: "var(--muted)", fontSize: 12 }}> · {s.vendor_name}</span>}</td>
                  <td>{dmy(s.created_at)}</td>
                  <td className="num">{s.total_sku}</td>
                </tr>
              ))}
              {srps.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No SRP yet. Make one in Perhitungan Harga (+ Create New SRP).</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
        <div className="fld" style={{ minWidth: 220, flex: "1 1 220px", maxWidth: 320 }}><label>Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={!platforms.length}>
            {platforms.length === 0 && <option value="">All (the lines have no platform yet)</option>}
            {platforms.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="fld" style={{ minWidth: 220, flex: "1 1 220px", maxWidth: 320 }}><label>Store name</label>
          <select value={storeId} onChange={(e) => pickStore(e.target.value)}>
            <option value="">Select store…</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="__new">+ New store…</option>
          </select>
        </div>
      </div>
      {platform && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Only the {platform} lines of the SRP are listed, and only {platform.toLowerCase().startsWith("shopee") ? "Shopee" : platform.toLowerCase().startsWith("tiktok") ? "Tokopedia / TikTok Shop" : platform} links are accepted.</div>}
      {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn-ghost" onClick={() => onClose(null)}>Cancel</button>
        <button className="btn-gold" disabled={saving || !srps?.length} onClick={create} style={{ padding: "10px 24px" }}>{saving ? "Connecting…" : "Connect"}</button>
      </div>
    </Modal>
  );
}

/* ── one connection: every product of the SRP, one Product URL each ── */
function ConnectionEditor({ supabase, clientId, isAdmin, conn, onBack, onDone }: {
  supabase: Supabase; clientId: string; isAdmin: boolean; conn: ConnLog; onBack: () => void; onDone: (text: string) => void;
}) {
  const [products, setProducts] = useState<ConnProduct[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "connected" | "missing">("all");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const allowed = allowedPlatforms(conn);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("pr_connection_products", { p_conn: conn.id });
    const list = (data as ConnProduct[]) || [];
    setProducts(list);
    setUrls(Object.fromEntries(list.map((p) => [p.prod_id, p.link?.product_url ?? ""])));
  }, [supabase, conn.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const dirtyIds = useMemo(() => (products || []).filter((p) => cleanUrl(urls[p.prod_id] || "") !== (p.link?.product_url ?? "")).map((p) => p.prod_id), [products, urls]);
  const connectedNow = (products || []).filter((p) => cleanUrl(urls[p.prod_id] || "")).length;
  const t = q.trim().toLowerCase();
  const shown = (products || []).filter((p) => {
    const has = !!cleanUrl(urls[p.prod_id] || "");
    if (show === "connected" && !has) return false;
    if (show === "missing" && has) return false;
    return !t || p.product_name.toLowerCase().includes(t) || p.prod_id.toLowerCase().includes(t) || (urls[p.prod_id] || "").toLowerCase().includes(t);
  });

  async function save() {
    if (!products) return;
    setErr(""); setSaving(true);
    try {
      const bad: string[] = [];
      const inserts: Record<string, unknown>[] = []; const updates: [string, string, Platform][] = []; const removals: string[] = [];
      for (const p of products) {
        const url = cleanUrl(urls[p.prod_id] || "");
        const had = p.link;
        if (!url) { if (had) removals.push(had.id); continue; }
        const platform = detectPlatform(url);
        if (!platform || (allowed && !allowed.includes(platform))) { bad.push(p.product_name); continue; }
        if (had) { if (had.product_url !== url) updates.push([had.id, url, platform]); continue; }
        inserts.push({ client_id: clientId, connection_id: conn.id, kode_produk: p.prod_id, product_name: p.product_name, platform, store_id: conn.store_id, store_name: conn.store_name, product_url: url });
      }
      if (bad.length) { setErr(`${bad.length} URL${bad.length === 1 ? " is" : "s are"} not ${allowed ? `a ${conn.platform} product link` : "a Shopee, Tokopedia or TikTok Shop product link"}: ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "…" : ""}`); return; }
      const dup = () => "A Product URL is already connected to this product in another connection.";
      if (removals.length) {
        for (let i = 0; i < removals.length; i += 100) {
          const { error } = await supabase.from("price_research_links").delete().in("id", removals.slice(i, i + 100));
          if (error) { setErr(error.message); return; }
        }
      }
      for (let i = 0; i < updates.length; i += 20) {
        const res = await Promise.all(updates.slice(i, i + 20).map(([id, url, platform]) => supabase.from("price_research_links").update({ product_url: url, platform }).eq("id", id)));
        const e = res.find((r) => r.error)?.error;
        if (e) { setErr(e.code === "23505" ? dup() : e.message); return; }
      }
      for (let i = 0; i < inserts.length; i += 100) {
        const { error } = await supabase.from("price_research_links").insert(inserts.slice(i, i + 100));
        if (error) { setErr(error.code === "23505" ? dup() : error.message); return; }
      }
      onDone(`${conn.srp_no || "Older links"} · ${conn.store_name}: saved. ${connectedNow} of ${products.length} products connected${removals.length ? `, ${removals.length} removed` : ""}.`);
    } finally { setSaving(false); }
  }

  async function delConn() {
    const n = (products || []).filter((p) => p.link).length;
    if (!window.confirm(`Delete the connection of ${conn.srp_no || "the older links"} to ${conn.store_name} with its ${n} Product URL${n === 1 ? "" : "s"} and their price history?`)) return;
    const { error } = await supabase.from("pr_connections").delete().eq("id", conn.id);
    if (error) { setErr(error.message); return; }
    onDone(`Connection to ${conn.store_name} deleted.`);
  }
  function back() {
    if (dirtyIds.length && !window.confirm(`${dirtyIds.length} Product URL${dirtyIds.length === 1 ? " is" : "s are"} not saved. Go back without saving?`)) return;
    onBack();
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn-ghost" onClick={back}>← Connections</button>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{conn.store_name}{conn.platform ? <span style={{ color: "var(--gold)" }}> · {conn.platform}</span> : null}</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {conn.srp_no ? <><b style={{ fontFamily: "monospace", color: "var(--gold)" }}>{conn.srp_no}</b> · Catalog <span style={{ fontFamily: "monospace" }}>{conn.catalog_no || "—"}</span></> : "Older links (no SRP)"}
            {" · "}{connectedNow} of {products?.length ?? conn.products} products connected
          </div>
        </div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {dirtyIds.length > 0 && <span style={{ color: "var(--gold)", fontSize: 12.5 }}>{dirtyIds.length} changed</span>}
            <button className="btn-ghost" onClick={delConn} style={{ color: "#f87171" }}>Delete connection</button>
            <button className="btn-gold" disabled={saving || !dirtyIds.length} onClick={save} style={{ padding: "10px 26px" }}>{saving ? "Saving…" : "Save"}</button>
          </div>
        )}
      </div>
      {err && <div style={{ color: "#f87171", fontSize: 13, margin: "6px 0" }}>✗ {err}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
        <div className="fld" style={{ minWidth: 260, flex: "1 1 260px", maxWidth: 420 }}><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product, Prod ID or URL" /></div>
        <div className="fld" style={{ minWidth: 170 }}><label>Show</label>
          <select value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
            <option value="all">All products</option>
            <option value="connected">With a Product URL</option>
            <option value="missing">Without a Product URL</option>
          </select></div>
      </div>
      {products === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "64vh" }}>
          <table className="tbl day-tbl">
            <thead><tr><th>SRP ID</th><th>Catalog ID</th><th>Product ID</th><th>Product Name</th><th className="num">Harga Jual (ours)</th><th>Product URL</th><th>Platform</th><th></th></tr></thead>
            <tbody>
              {shown.map((p) => {
                const url = cleanUrl(urls[p.prod_id] || "");
                const platform = url ? detectPlatform(url) : null;
                const changed = url !== (p.link?.product_url ?? "");
                return (
                  <tr key={p.prod_id} style={changed ? { background: "rgba(201,162,39,.06)" } : undefined}>
                    <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>{conn.srp_no || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>{conn.catalog_no || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{p.prod_id}</td>
                    <td style={{ minWidth: 220, maxWidth: 340, whiteSpace: "normal", overflowWrap: "anywhere", fontWeight: 700 }}>{p.product_name}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{rp(ourPrice(p, platform, !!conn.platform))}</td>
                    <td style={{ minWidth: 300 }}>
                      {isAdmin ? (
                        <input value={urls[p.prod_id] ?? ""} onChange={(e) => setUrls((x) => ({ ...x, [p.prod_id]: e.target.value }))} placeholder="Paste the Product URL, or leave empty if the store does not sell it"
                          style={{ width: "100%", background: "rgba(10,22,40,.5)", border: `1px solid ${url && (!platform || (allowed && !allowed.includes(platform))) ? "rgba(248,113,113,.7)" : "rgba(201,162,39,.25)"}`, borderRadius: 6, padding: "6px 8px", color: "var(--text)", fontSize: 12.5 }} />
                      ) : (p.link ? <a href={p.link.product_url} target="_blank" rel="noopener noreferrer" style={{ color: "#cfe0ff" }}>{p.link.product_url}</a> : "—")}
                    </td>
                    <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{platform && !(allowed && !allowed.includes(platform)) ? PLATFORM_LABEL[platform] : url ? <span style={{ color: "#f87171" }}>{platform ? `not a ${conn.platform} link` : "not a product link"}</span> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {isAdmin && urls[p.prod_id] && <button className="btn-ghost" title="Clear this URL" onClick={() => setUrls((x) => ({ ...x, [p.prod_id]: "" }))} style={{ color: "#f87171" }}>✕</button>}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{products.length ? "No product matches." : "This SRP has no product with a Prod ID yet."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ── the store names ── */
function StoresModal({ supabase, clientId, stores, links, onClose }: { supabase: Supabase; clientId: string; stores: Store[]; links: { store_id: string | null }[]; onClose: () => void }) {
  const [list, setList] = useState(stores);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const used = (id: string) => links.filter((l) => l.store_id === id).length;
  async function add() {
    setErr("");
    const n = name.trim(); if (!n) return;
    const { data, error } = await supabase.from("pr_stores").insert({ client_id: clientId, name: n }).select("id, name").single();
    if (error) { setErr(error.code === "23505" ? "This store name already exists." : error.message); return; }
    setList((x) => [...x, data as Store].sort((a, b) => a.name.localeCompare(b.name))); setName("");
  }
  async function rename(s: Store) {
    const n = window.prompt("Store name", s.name); if (!n || n.trim() === s.name) return;
    const { error } = await supabase.from("pr_stores").update({ name: n.trim() }).eq("id", s.id);
    if (error) { setErr(error.code === "23505" ? "This store name already exists." : error.message); return; }
    await supabase.from("price_research_links").update({ store_name: n.trim() }).eq("store_id", s.id);
    await supabase.from("pr_connections").update({ store_name: n.trim() }).eq("store_id", s.id);
    setList((x) => x.map((y) => y.id === s.id ? { ...y, name: n.trim() } : y));
  }
  async function del(s: Store) {
    if (used(s.id)) { setErr("This store is still connected to a Product URL."); return; }
    await supabase.from("pr_stores").delete().eq("id", s.id);
    setList((x) => x.filter((y) => y.id !== s.id));
  }
  return (
    <Modal onClose={onClose} width={520}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>Store names</div>
        <button className="btn-ghost" onClick={onClose}>✕ Close</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="New store name (e.g. SM.Elektro)" />
        <button className="btn-gold" onClick={add} style={{ padding: "8px 18px" }}>+ Add</button>
      </div>
      {err && <div style={{ color: "#f87171", fontSize: 12.5, marginBottom: 8 }}>✗ {err}</div>}
      <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
        {list.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderBottom: "1px solid var(--line)" }}>
            <span style={{ flex: 1 }}>{s.name}</span>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{used(s.id)} URL{used(s.id) === 1 ? "" : "s"}</span>
            <button className="btn-ghost" onClick={() => rename(s)}>Rename</button>
            <button className="btn-ghost" onClick={() => del(s)} style={{ color: "#f87171" }}>✕</button>
          </div>
        ))}
        {list.length === 0 && <div style={{ color: "var(--muted)", padding: 14, textAlign: "center" }}>No store yet.</div>}
      </div>
    </Modal>
  );
}
