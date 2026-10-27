"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { fmtDateTime } from "@/lib/dates";
import { PLATFORMS, cleanUrl, detectPlatform, estimateCost, type Platform } from "@/lib/priceResearch";
import { CATALOG_EXAMPLE, CATALOG_HEADER, parseCatalogMatrix } from "@/lib/catalogXls";

export const dynamic = "force-dynamic";

// Price Calculator > Price Research
//   Price Guard   per product: the SRP first (Baseline), then every connected store: Price Input (the price before the shop's discount),
//                 Price Discount (what a buyer pays after it), promo labels, and Higher / Under / Same against the SRP.
//   Product URL   which product is sold by which store, and its Product URL (one product, many stores). Store names come from a dropdown.
//   Product Catalog  our own products: Product Name, Prod ID, SRP ID, Price SRP (every SRP change is logged); typed by hand or imported from an XLS.
//                 The Massive Calculator uses the same catalog.
// Prices are scraped ON DEMAND (button) through Apify.
type Supabase = ReturnType<typeof createClient>;
type SrpProduct = { id: string; prod_id: string; product_name: string; srp_id: string | null; price_srp: number | null; created_at: string };
type Store = { id: string; name: string };
type LinkRow = { id: string; kode_produk: string; platform: Platform; store_id: string | null; store_name: string | null; product_url: string };
type RunInfo = { id: string; platform: Platform; status: "running" | "done" | "failed"; scraped: number; failed: number; error: string | null; started_at: string; links: number };
type GuardStore = { link_id: string; store: string; platform: Platform; product_url: string; scraped_at: string | null; ok: boolean | null; error: string | null;
  price_original: number | null; price_sell: number | null; discount_pct: number | null; labels: string[] | null };
type GuardProduct = { product_id: string; prod_id: string; product_name: string; srp: number | null; srp_id: string | null; scraped_at: string | null; stores: GuardStore[] };
type LogRow = { id: number; srp_id: string | null; price_srp: number | null; old_srp_id: string | null; old_price_srp: number | null; effective_from: string; changed_by: string | null; changed_at: string };
type TabKey = "guard" | "urls" | "products";

const rp = (n: number | null | undefined) => n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID");
const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.v, p.label])) as Record<Platform, string>;
const today = () => new Date().toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
// dd mmm yyyy (Jan - Des), in Jakarta time
function dmy(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v); if (Number.isNaN(d.getTime())) return "—";
  const j = new Date(d.getTime() + 7 * 3600_000);
  return `${String(j.getUTCDate()).padStart(2, "0")} ${MON[j.getUTCMonth()]} ${j.getUTCFullYear()}`;
}

// Status against the SRP: the price a buyer pays (Price Discount, or Price Input when there is no discount)
function status(sell: number | null, srp: number | null): { text: string; color: string } {
  if (sell == null || !srp) return { text: srp ? "—" : "no SRP", color: "var(--muted)" };
  const d = (sell / srp - 1) * 100;
  if (Math.abs(d) < 0.5) return { text: "Same", color: "var(--gold)" };
  return d < 0 ? { text: `Under ${d.toFixed(1)}%`, color: "#f87171" } : { text: `Higher +${d.toFixed(1)}%`, color: "#86efac" };
}

export default function PriceResearchPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<TabKey>("guard");
  const [urlFilter, setUrlFilter] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [allLinks, setAllLinks] = useState<{ id: string; platform: Platform }[]>([]);
  const [starting, setStarting] = useState(false);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);                       // reload everything after a scrape or an edit

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: cs }, { data: p }] = await Promise.all([
        supabase.from("clients").select("id").order("created_at").limit(1),
        supabase.from("profiles").select("role").eq("id", user.id).single(),
      ]);
      setClientId((cs as { id: string }[])?.[0]?.id || "");
      setIsAdmin(["superadmin", "client_admin"].includes((p as { role?: string } | null)?.role || ""));
    })();
  }, [supabase]);

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data: l } = await supabase.from("price_research_links").select("id, platform").eq("client_id", clientId);
      setAllLinks((l as { id: string; platform: Platform }[]) || []);
    })();
  }, [supabase, clientId, tick]);

  const running = runs.filter((r) => r.status === "running");
  const busy = starting || running.length > 0;

  // running scrapes are polled every 4 seconds (the server asks Apify and saves the prices when it has finished)
  const pollRuns = useCallback(async (): Promise<RunInfo[]> => {
    const res = await fetch("/api/price-research/runs");
    if (!res.ok) return [];
    const j = await res.json().catch(() => ({ runs: [] }));
    const list = (j.runs as RunInfo[]) || [];
    setRuns(list); setNow(Date.now());
    return list;
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (isAdmin) pollRuns(); }, [isAdmin, pollRuns]);
  useEffect(() => {
    if (!running.length) return;
    const h = setInterval(async () => {
      const list = await pollRuns();
      if (!list.some((r) => r.status === "running")) {
        const done = list.filter((r) => r.status === "done"), bad = list.filter((r) => r.status === "failed");
        const saved = done.reduce((x, r) => x + r.scraped, 0), failed = done.reduce((x, r) => x + r.failed, 0) + bad.reduce((x, r) => x + r.failed, 0);
        setMsg({ ok: failed === 0, text: `Scrape finished: ${saved} price${saved === 1 ? "" : "s"} saved${failed ? ` · ${failed} failed: ${[...done, ...bad].map((r) => r.error).find(Boolean) || "see the Price Guard rows"}` : ""}` });
        setTick((t) => t + 1);
      }
    }, 4000);
    return () => clearInterval(h);
  }, [running.length, pollRuns]);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);

  async function scrape(ids: string[], label: string) {
    if (!ids.length) { setMsg({ ok: false, text: "No Product URL yet. Connect products to their Product URL first." }); return false; }
    const counts: Partial<Record<Platform, number>> = {};
    for (const id of ids) { const p = allLinks.find((l) => l.id === id)?.platform; if (p) counts[p] = (counts[p] || 0) + 1; }
    if (!window.confirm(`Scrape ${ids.length} price${ids.length === 1 ? "" : "s"} (${label}) now?\nEstimated Apify cost: about US$ ${estimateCost(counts).toFixed(3)}.\nIt runs on Apify and takes about a minute; you can keep working.`)) return false;
    setStarting(true); setMsg(null);
    const res = await fetch("/api/price-research/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link_ids: ids }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setStarting(false); setMsg({ ok: false, text: j.error || `Scrape failed (${res.status})` }); return false; }
    await pollRuns();
    setStarting(false);
    if (j.failed) setMsg({ ok: false, text: `${j.failed} link${j.failed === 1 ? "" : "s"} could not start: ${(j.errors || []).join(" | ")}` });
    return true;
  }

  const subTab = (v: TabKey, label: string) => (
    <button onClick={() => { setTab(v); if (v !== "urls") setUrlFilter(""); }} style={{ padding: "9px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700,
      border: tab === v ? "1px solid var(--gold)" : "1px solid rgba(255,255,255,.1)", background: tab === v ? "rgba(201,162,39,.15)" : "rgba(10,22,40,.5)", color: tab === v ? "var(--gold)" : "#e8edf8" }}>{label}</button>
  );

  return (
    <>
      <style>{`
        .mode-tab{padding:7px 16px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
        .mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
      `}</style>
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <Link href="/calc" className="mode-tab">Massive Calculator</Link>
        <Link href="/calc/marketplace-fee" className="mode-tab">Marketplace Fee</Link>
        <span className="mode-tab on">Price Research</span>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Price Research</h3>
            <div className="hint">Enter our products and their SRP in the <b>Product Catalog</b> (or import them from an XLS), connect them to the stores&apos; pages in <b>Product URL</b>, scrape, and read the result in <b>Price Guard</b>.</div>
          </div>
          {isAdmin && (
            <button className="btn-gold" disabled={busy || !allLinks.length} onClick={() => scrape(allLinks.map((l) => l.id), "all Product URLs")} style={{ padding: "10px 22px" }}>
              {busy ? "Scraping on Apify…" : `Scrape all (${allLinks.length})`}
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>{subTab("guard", "Price Guard")}{subTab("urls", "Product URL")}{subTab("products", "Product Catalog")}</div>
        {running.length > 0 && (
          <div style={{ color: "var(--gold)", fontSize: 13, marginBottom: 10 }}>
            ⏳ Scraping on Apify: {running.map((r) => `${PLATFORM_LABEL[r.platform]} · ${r.links} link${r.links === 1 ? "" : "s"} · ${Math.max(0, Math.round((now - new Date(r.started_at).getTime()) / 1000))}s`).join("   |   ")} — the prices appear when it finishes.
          </div>
        )}
        {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", fontSize: 13, marginBottom: 10 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}

        {clientId && tab === "guard" && <GuardTab supabase={supabase} clientId={clientId} tick={tick} />}
        {clientId && tab === "urls" && <UrlsTab supabase={supabase} clientId={clientId} isAdmin={isAdmin} tick={tick} busy={busy} filter={urlFilter} setFilter={setUrlFilter} onScrape={scrape} onChanged={() => setTick((t) => t + 1)} />}
        {clientId && tab === "products" && <ProductsTab supabase={supabase} clientId={clientId} isAdmin={isAdmin} tick={tick} onUrls={(p) => { setUrlFilter(p.prod_id); setTab("urls"); }} onChanged={() => setTick((t) => t + 1)} />}
      </div>
    </>
  );
}

/* ── Price Guard: the SRP first, then every store ── */
function GuardTab({ supabase, clientId, tick }: { supabase: Supabase; clientId: string; tick: number }) {
  const [asof, setAsof] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<GuardProduct[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("price_guard", { p_client_id: clientId, p_asof: asof || null, p_q: q.trim() || null });
    setErr(error ? error.message : "");
    setRows((data as GuardProduct[]) || []);
  }, [supabase, clientId, asof, q]);
  useEffect(() => { const h = setTimeout(load, q ? 300 : 0); return () => clearTimeout(h); }, [load, q, tick]);

  const th: React.CSSProperties = {};
  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div className="fld" style={{ minWidth: 280, flex: 1 }}><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product, Prod ID or store" /></div>
        <div className="fld" style={{ minWidth: 170 }}><label>Prices as of</label><input type="date" value={asof} max={today()} onChange={(e) => setAsof(e.target.value)} style={{ colorScheme: "dark" }} /></div>
        {asof && <button className="btn-ghost" onClick={() => setAsof("")}>Now</button>}
      </div>
      {err && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 10 }}>✗ {err}</div>}
      {rows === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "68vh" }}>
          <table className="tbl day-tbl">
            <thead><tr>
              <th style={th}>Date</th><th>Produk</th><th>Store</th><th className="num">Price Input</th><th className="num">Price Discount</th><th>Promo Labels</th><th>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <Fragment key={p.product_id}>
                  <tr style={{ background: "rgba(201,162,39,.07)", borderTop: "2px solid rgba(201,162,39,.25)" }}>
                    <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{dmy(p.scraped_at)}</td>
                    <td style={{ minWidth: 240, maxWidth: 380, whiteSpace: "normal", overflowWrap: "anywhere", fontWeight: 700 }}>
                      {p.product_name}
                      <div style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)", fontFamily: "monospace" }}>{p.prod_id}{p.srp_id ? ` · ${p.srp_id}` : ""}</div>
                    </td>
                    <td style={{ fontWeight: 800, color: "var(--gold)" }}>SRP</td>
                    <td className="num" style={{ fontWeight: 800 }}>{rp(p.srp)}</td>
                    <td className="num" style={{ color: "var(--muted)" }}>-</td>
                    <td style={{ color: "var(--muted)" }}>-</td>
                    <td><span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 800, border: "1px solid rgba(201,162,39,.5)", color: "var(--gold)" }}>Baseline</span></td>
                  </tr>
                  {p.stores.map((s) => {
                    const discounted = s.price_original != null && s.price_sell != null && s.price_original > s.price_sell;
                    const st = s.ok ? status(s.price_sell, p.srp) : s.ok === false ? { text: "Failed", color: "#f87171" } : { text: "Not scraped", color: "var(--muted)" };
                    return (
                      <tr key={s.link_id}>
                        <td></td><td></td>
                        <td style={{ whiteSpace: "normal" }}>
                          <a href={s.product_url} target="_blank" rel="noopener noreferrer" style={{ color: "#e8edf8", fontWeight: 600 }}>{s.store}</a>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{PLATFORM_LABEL[s.platform]}{s.scraped_at && s.scraped_at.slice(0, 10) !== (p.scraped_at || "").slice(0, 10) ? ` · ${dmy(s.scraped_at)}` : ""}</div>
                        </td>
                        <td className="num">{s.ok ? rp(s.price_original) : "—"}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{s.ok && discounted ? rp(s.price_sell) : "-"}</td>
                        <td style={{ whiteSpace: "normal", maxWidth: 240 }}>
                          {s.labels?.length ? s.labels.map((l) => <span key={l} style={{ display: "inline-block", margin: "0 4px 4px 0", padding: "2px 8px", borderRadius: 999, fontSize: 11, border: "1px solid rgba(201,162,39,.4)", color: "var(--gold)" }}>{l}</span>) : "-"}
                        </td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 700, color: st.color }} title={s.error || undefined}>{st.text}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Nothing to compare yet. Add products in the Product Catalog, connect them to a Product URL, then press Scrape.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
        Price Input = the store&apos;s price before its discount. Price Discount = what a buyer pays after the discount (&quot;-&quot; when there is none). Status compares that price with the SRP valid on the date. Personal vouchers (for example a VIP voucher) and checkout costs differ per buyer and are not public, so they are not included.
      </div>
    </>
  );
}

/* ── Product URL: product ↔ store ↔ Product URL ── */
function UrlsTab({ supabase, clientId, isAdmin, tick, busy, filter, setFilter, onScrape, onChanged }: {
  supabase: Supabase; clientId: string; isAdmin: boolean; tick: number; busy: boolean; filter: string; setFilter: (v: string) => void;
  onScrape: (ids: string[], label: string) => Promise<boolean>; onChanged: () => void;
}) {
  const [products, setProducts] = useState<SrpProduct[] | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [f, setF] = useState({ product_id: "", store_id: "", url: "" });
  const [err, setErr] = useState("");
  const [manage, setManage] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: s }, { data: l }] = await Promise.all([
        supabase.from("pr_srp_products").select("id, prod_id, product_name, srp_id, price_srp, created_at").eq("client_id", clientId).order("product_name"),
        supabase.from("pr_stores").select("id, name").eq("client_id", clientId).order("name"),
        supabase.from("price_research_links").select("id, kode_produk, platform, store_id, store_name, product_url").eq("client_id", clientId).order("created_at"),
      ]);
      setProducts((p as SrpProduct[]) || []); setStores((s as Store[]) || []); setLinks((l as LinkRow[]) || []);
    })();
  }, [supabase, clientId, tick]);

  async function addStoreByName(name: string): Promise<Store | null> {
    const n = name.trim(); if (!n) return null;
    const have = stores.find((s) => s.name.toLowerCase() === n.toLowerCase());
    if (have) return have;
    const { data, error } = await supabase.from("pr_stores").insert({ client_id: clientId, name: n }).select("id, name").single();
    if (error) { setErr(error.message); return null; }
    return data as Store;
  }
  async function pickStore(v: string) {
    if (v !== "__new") { setF({ ...f, store_id: v }); return; }
    const name = window.prompt("New store name");
    if (!name) return;
    const s = await addStoreByName(name);
    if (s) { setStores((x) => [...x, s].sort((a, b) => a.name.localeCompare(b.name))); setF({ ...f, store_id: s.id }); }
  }
  async function connect() {
    setErr("");
    const product = products?.find((p) => p.id === f.product_id);
    const store = stores.find((s) => s.id === f.store_id);
    const url = cleanUrl(f.url);
    if (!product) { setErr("Pick a product."); return; }
    if (!store) { setErr("Pick a store (or add a new one in the dropdown)."); return; }
    const platform = detectPlatform(url);
    if (!platform) { setErr("The Product URL must be a Shopee, Tokopedia or TikTok Shop product link."); return; }
    const { error } = await supabase.from("price_research_links").insert({
      client_id: clientId, kode_produk: product.prod_id, product_name: product.product_name, platform, store_id: store.id, store_name: store.name, product_url: url,
    });
    if (error) { setErr(error.code === "23505" ? "This Product URL is already connected to this product." : error.message); return; }
    setF({ ...f, url: "" });
    onChanged();
  }
  async function changeStore(l: LinkRow, storeId: string) {
    const s = stores.find((x) => x.id === storeId); if (!s) return;
    await supabase.from("price_research_links").update({ store_id: s.id, store_name: s.name }).eq("id", l.id);
    onChanged();
  }
  async function del(l: LinkRow) {
    if (!window.confirm("Remove this Product URL and its price history?")) return;
    await supabase.from("price_research_links").delete().eq("id", l.id);
    onChanged();
  }

  const t = filter.trim().toLowerCase();
  const shown = (products || []).filter((p) => !t || p.product_name.toLowerCase().includes(t) || p.prod_id.toLowerCase().includes(t)
    || links.some((l) => l.kode_produk === p.prod_id && ((l.store_name || "").toLowerCase().includes(t) || l.product_url.toLowerCase().includes(t))));
  const linked = shown.filter((p) => links.some((l) => l.kode_produk === p.prod_id));

  return (
    <>
      {isAdmin && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
          <div className="fld" style={{ minWidth: 240, flex: "1 1 240px" }}><label>Product</label>
            <select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
              <option value="">{products && products.length ? "Select product…" : "Add products first (Product Catalog tab)"}</option>
              {(products || []).map((p) => <option key={p.id} value={p.id}>{p.product_name} · {p.prod_id}</option>)}
            </select>
          </div>
          <div className="fld" style={{ minWidth: 190, flex: "0 1 200px" }}><label>Store name</label>
            <select value={f.store_id} onChange={(e) => pickStore(e.target.value)}>
              <option value="">Select store…</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="__new">+ New store…</option>
            </select>
          </div>
          <div className="fld" style={{ minWidth: 260, flex: "2 1 260px" }}><label>Product URL</label><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && connect()} placeholder="https://shopee.co.id/…-i.<shop>.<item>  or  tokopedia.com/…  or  shop-id.tokopedia.com/pdp/…" /></div>
          <button className="btn-gold" onClick={connect} style={{ padding: "10px 22px" }}>+ Connect</button>
          <button className="btn-ghost" onClick={() => setManage(true)}>Stores ({stores.length})</button>
        </div>
      )}
      {err && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 10 }}>✗ {err}</div>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
        <div className="fld" style={{ minWidth: 260, flex: 1 }}><label>Search</label><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Product, Prod ID, store or URL" /></div>
      </div>
      {products === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "62vh" }}>
          <table className="tbl day-tbl">
            <thead><tr><th>Product Name</th><th>Product ID</th><th>Store Name</th><th>Product URL</th><th></th></tr></thead>
            <tbody>
              {linked.map((p) => {
                const ls = links.filter((l) => l.kode_produk === p.prod_id);
                return ls.map((l, i) => (
                  <tr key={l.id} style={i === 0 ? { borderTop: "2px solid rgba(201,162,39,.2)" } : undefined}>
                    <td style={{ minWidth: 220, maxWidth: 340, whiteSpace: "normal", overflowWrap: "anywhere", fontWeight: 700 }}>{i === 0 ? p.product_name : ""}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{i === 0 ? p.prod_id : ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {isAdmin ? (
                        <select value={l.store_id || ""} onChange={(e) => changeStore(l, e.target.value)} style={{ minWidth: 150 }}>
                          {!l.store_id && <option value="">{l.store_name || "—"}</option>}
                          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      ) : (l.store_name || "—")}
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{PLATFORM_LABEL[l.platform]}</div>
                    </td>
                    <td style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><a href={l.product_url} target="_blank" rel="noopener noreferrer" style={{ color: "#cfe0ff" }} title={l.product_url}>{l.product_url}</a></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {isAdmin && <button className="btn-ghost" disabled={busy} onClick={() => onScrape([l.id], "1 Product URL")}>Scrape</button>}{" "}
                      {isAdmin && <button className="btn-ghost" onClick={() => del(l)} style={{ color: "#f87171" }}>✕</button>}
                    </td>
                  </tr>
                ));
              })}
              {linked.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{(products || []).length ? "No Product URL connected yet — choose a product, a store and paste the URL above." : "No product yet. Add your products in the Product Catalog tab first."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {manage && <StoresModal supabase={supabase} clientId={clientId} stores={stores} links={links} onClose={() => { setManage(false); onChanged(); }} />}
    </>
  );
}

function StoresModal({ supabase, clientId, stores, links, onClose }: { supabase: Supabase; clientId: string; stores: Store[]; links: LinkRow[]; onClose: () => void }) {
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

/* ── Products: our products with their SRP (manual) ── */
function ProductsTab({ supabase, clientId, isAdmin, tick, onUrls, onChanged }: {
  supabase: Supabase; clientId: string; isAdmin: boolean; tick: number; onUrls: (p: SrpProduct) => void; onChanged: () => void;
}) {
  const [rows, setRows] = useState<SrpProduct[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<SrpProduct> | null>(null);
  const [logOf, setLogOf] = useState<SrpProduct | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [effective, setEffective] = useState(today());

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("pr_srp_products").select("id, prod_id, product_name, srp_id, price_srp, created_at").eq("client_id", clientId).order("created_at");
      setRows((data as SrpProduct[]) || []);
      const { data: l } = await supabase.from("price_research_links").select("kode_produk").eq("client_id", clientId);
      const m: Record<string, number> = {};
      for (const x of (l as { kode_produk: string }[]) || []) m[x.kode_produk] = (m[x.kode_produk] || 0) + 1;
      setCounts(m);
    })();
  }, [supabase, clientId, tick]);

  const shown = (rows || []).filter((r) => { const t = q.trim().toLowerCase(); return !t || r.product_name.toLowerCase().includes(t) || r.prod_id.toLowerCase().includes(t) || (r.srp_id || "").toLowerCase().includes(t); });
  async function del(p: SrpProduct) {
    if (!window.confirm(`Delete ${p.product_name}? Its Product URLs and scraped prices are deleted too.`)) return;
    await supabase.from("price_research_links").delete().eq("client_id", clientId).eq("kode_produk", p.prod_id);
    await supabase.from("pr_srp_products").delete().eq("id", p.id);
    onChanged();
  }

  // the XLS template is the empty sheet (one example row); the export is the catalog as it is now, so it can be edited and imported back
  async function downloadXls(withRows: boolean) {
    const XLSX = await import("xlsx");
    const body: (string | number)[][] = withRows ? (rows || []).map((r, i) => [i + 1, r.srp_id || "", r.product_name, r.prod_id, r.price_srp ?? ""]) : [CATALOG_EXAMPLE as (string | number)[]];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[...CATALOG_HEADER], ...body]);
    ws["!cols"] = [{ wch: 6 }, { wch: 16 }, { wch: 46 }, { wch: 18 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, "Product Catalog");
    const guide = XLSX.utils.aoa_to_sheet([
      ["How to fill"], [""],
      ["Prod ID", "Required and unique: it is the key. A Prod ID that is already in the catalog is UPDATED, a new one is ADDED."],
      ["Product Name", "Required."],
      ["SRP ID", "Your own name for the SRP version, e.g. SRP-2026-10."],
      ["Price SRP", "In Rp (7500000 or Rp 7.500.000)."],
      ["SRP changes", "When the SRP ID or the Price SRP of a known Prod ID changes, the old SRP stays in the SRP log and the new one counts from the date you choose when you import."],
      ["No", "Only a counter, it is ignored."],
    ]);
    guide["!cols"] = [{ wch: 18 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(wb, guide, "Guide");
    XLSX.writeFile(wb, withRows ? "product-catalog-export.xlsx" : "product-catalog-template.xlsx");
  }

  async function importXls(file: File) {
    setImporting(true); setImportMsg(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });
      const parsed = parseCatalogMatrix(matrix);
      if (parsed.error) { setImportMsg({ ok: false, text: parsed.error }); return; }
      if (!parsed.rows.length) { setImportMsg({ ok: false, text: "No product row found in the sheet." }); return; }
      const total = { added: 0, updated: 0, unchanged: 0, errors: [] as { row: number; error: string }[] };
      for (let i = 0; i < parsed.rows.length; i += 500) {
        const { data, error } = await supabase.rpc("pr_srp_import", { p_client_id: clientId, p_rows: parsed.rows.slice(i, i + 500), p_effective: effective || null });
        if (error) { setImportMsg({ ok: false, text: error.message }); return; }
        const r = data as typeof total;
        total.added += r.added; total.updated += r.updated; total.unchanged += r.unchanged; total.errors.push(...r.errors.map((e) => ({ row: e.row + i, error: e.error })));
      }
      const bad = [...parsed.skipped.map((x) => `row ${x.row}: ${x.reason}`), ...total.errors.map((x) => `product ${x.row}: ${x.error}`)];
      setImportMsg({ ok: bad.length === 0, text: `${total.added} added · ${total.updated} updated · ${total.unchanged} unchanged${bad.length ? ` · ${bad.length} skipped: ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "…" : ""}` : ""}` });
      onChanged();
    } finally { setImporting(false); }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div className="fld" style={{ minWidth: 260, flex: 1 }}><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product name, Prod ID or SRP ID" /></div>
        <button className="btn-ghost" onClick={() => downloadXls(false)}>⬇ Template XLS</button>
        <button className="btn-ghost" onClick={() => downloadXls(true)} disabled={!rows?.length}>⬇ Export XLS</button>
        {isAdmin && (
          <>
            <div className="fld" style={{ minWidth: 150 }}><label>SRP valid from (import)</label><input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} style={{ colorScheme: "dark" }} /></div>
            <label className="btn-ghost" style={{ cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.6 : 1 }}>
              {importing ? "Importing…" : "Import XLS"}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} disabled={importing}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importXls(f); e.target.value = ""; }} />
            </label>
            <button className="btn-gold" onClick={() => setEdit({})} style={{ padding: "10px 22px" }}>+ Add product</button>
          </>
        )}
      </div>
      {importMsg && <div style={{ color: importMsg.ok ? "var(--gold)" : "#f87171", fontSize: 13, marginBottom: 10 }}>{importMsg.ok ? "✓" : "✗"} {importMsg.text}</div>}
      {rows === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "66vh" }}>
          <table className="tbl day-tbl">
            <thead><tr><th className="num">No</th><th>SRP ID</th><th>Product Name</th><th>Prod ID</th><th className="num">Price SRP</th><th className="num">Product URLs</th><th></th></tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id}>
                  <td className="num">{i + 1}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.srp_id || "—"}</td>
                  <td style={{ minWidth: 220, maxWidth: 380, whiteSpace: "normal", overflowWrap: "anywhere" }}>{r.product_name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.prod_id}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{rp(r.price_srp)}</td>
                  <td className="num">{counts[r.prod_id] ? <b style={{ color: "var(--gold)" }}>{counts[r.prod_id]}</b> : <span style={{ color: "var(--muted)" }}>0</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn-ghost" onClick={() => onUrls(r)}>{counts[r.prod_id] ? "Product URL" : "+ Product URL"}</button>{" "}
                    <button className="btn-ghost" onClick={() => setLogOf(r)}>SRP log</button>{" "}
                    {isAdmin && <button className="btn-ghost" onClick={() => setEdit(r)}>Edit</button>}{" "}
                    {isAdmin && <button className="btn-ghost" onClick={() => del(r)} style={{ color: "#f87171" }}>✕</button>}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{rows.length ? "No product matches." : "No product yet — press + Add product, or fill the XLS template and Import it."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ProductModal supabase={supabase} clientId={clientId} product={edit} onClose={(saved) => { setEdit(null); if (saved) onChanged(); }} />}
      {logOf && <SrpLogModal supabase={supabase} product={logOf} onClose={() => setLogOf(null)} />}
    </>
  );
}

function Modal({ children, onClose, width = 640 }: { children: React.ReactNode; onClose: () => void; width?: number }) {
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(2,6,16,.72)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(13,26,54,.98)", border: "1px solid rgba(201,162,39,.28)", borderRadius: 18, padding: 22, width: `min(${width}px, 100%)`, boxShadow: "0 30px 80px rgba(0,0,0,.6)" }}>{children}</div>
    </div>,
    document.body,
  );
}

function ProductModal({ supabase, clientId, product, onClose }: { supabase: Supabase; clientId: string; product: Partial<SrpProduct>; onClose: (saved: boolean) => void }) {
  const isNew = !product.id;
  const [f, setF] = useState({ prod_id: product.prod_id || "", product_name: product.product_name || "", srp_id: product.srp_id || "", price_srp: product.price_srp != null ? String(product.price_srp) : "", effective: today() });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const srpChanged = !isNew && (f.srp_id.trim() !== (product.srp_id || "") || Number(f.price_srp || 0) !== Number(product.price_srp || 0));

  async function save() {
    setErr("");
    const price = f.price_srp.trim() === "" ? null : Number(f.price_srp.replace(/[^\d]/g, ""));
    if (!f.prod_id.trim() || !f.product_name.trim()) { setErr("Prod ID and Product Name are required."); return; }
    setSaving(true);
    const { error } = await supabase.rpc("pr_srp_save", { p_client_id: clientId, p_id: product.id || null, p_prod_id: f.prod_id, p_product_name: f.product_name, p_srp_id: f.srp_id, p_price_srp: price, p_effective: f.effective || null });
    setSaving(false);
    if (error) { setErr(/duplicate|unique/i.test(error.message) ? "This Prod ID is already in the list." : error.message.replace(/^[A-Z_]+:\s*/, "")); return; }
    onClose(true);
  }

  return (
    <Modal onClose={() => onClose(false)}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 14 }}>{isNew ? "Add product" : "Edit product"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="fld" style={{ gridColumn: "1 / -1" }}><label>Product Name</label><input value={f.product_name} onChange={(e) => setF({ ...f, product_name: e.target.value })} placeholder="AC Panasonic 2 PK CS-YN18AKJ" /></div>
        <div className="fld"><label>Prod ID</label><input value={f.prod_id} onChange={(e) => setF({ ...f, prod_id: e.target.value })} placeholder="e.g. 9078737678 or CS-YN18AKJ" /></div>
        <div className="fld"><label>SRP ID</label><input value={f.srp_id} onChange={(e) => setF({ ...f, srp_id: e.target.value })} placeholder="e.g. SRP-2026-10" /></div>
        <div className="fld"><label>Price SRP (Rp)</label><input inputMode="numeric" value={f.price_srp} onChange={(e) => setF({ ...f, price_srp: e.target.value.replace(/[^\d]/g, "") })} placeholder="7500000" /></div>
        <div className="fld"><label>SRP valid from</label><input type="date" value={f.effective} onChange={(e) => setF({ ...f, effective: e.target.value })} style={{ colorScheme: "dark" }} /></div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
        {isNew ? "The first SRP is logged from the date above." : srpChanged ? <span style={{ color: "var(--gold)" }}>The SRP changes: the old SRP stays in the log, and the new one counts from the date above (Price Guard as of an earlier date keeps the old SRP).</span> : "Changing the SRP ID or the price adds a line to the SRP log."}
      </div>
      {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn-ghost" onClick={() => onClose(false)}>Cancel</button>
        <button className="btn-gold" disabled={saving} onClick={save} style={{ padding: "10px 24px" }}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

function SrpLogModal({ supabase, product, onClose }: { supabase: Supabase; product: SrpProduct; onClose: () => void }) {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("pr_srp_log").select("id, srp_id, price_srp, old_srp_id, old_price_srp, effective_from, changed_by, changed_at").eq("product_id", product.id).order("effective_from", { ascending: false }).order("id", { ascending: false });
      setRows((data as LogRow[]) || []);
    })();
  }, [supabase, product.id]);
  return (
    <Modal onClose={onClose} width={760}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div><div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>SRP log</div><div style={{ fontSize: 12.5, color: "var(--muted)" }}>{product.product_name} · {product.prod_id}</div></div>
        <button className="btn-ghost" onClick={onClose} style={{ alignSelf: "flex-start" }}>✕ Close</button>
      </div>
      {rows === null ? <Loader center /> : (
        <div className="tbl-wrap">
          <table className="tbl day-tbl">
            <thead><tr><th>Valid from</th><th>SRP ID</th><th className="num">Price SRP</th><th>Before</th><th>Changed by</th><th>Changed at</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{dmy(r.effective_from + "T00:00:00+07:00")}</td><td style={{ fontFamily: "monospace" }}>{r.srp_id || "—"}</td><td className="num" style={{ fontWeight: 700 }}>{rp(r.price_srp)}</td>
                  <td style={{ color: "var(--muted)" }}>{r.old_srp_id || r.old_price_srp != null ? `${r.old_srp_id || "—"} · ${rp(r.old_price_srp)}` : "first SRP"}</td>
                  <td>{r.changed_by || "—"}</td><td>{fmtDateTime(r.changed_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No SRP saved yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
