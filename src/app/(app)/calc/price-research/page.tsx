"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { PLATFORMS, cleanUrl, estimateCost, urlMatchesPlatform, type Platform } from "@/lib/priceResearch";

export const dynamic = "force-dynamic";

// Price Calculator > Price Research: our products (Panasonic SKUs with our average selling price) and, per SKU, the competitor links
// (marketplace + store URL + product URL). Prices are scraped ON DEMAND (button) through Apify and kept as dated snapshots.
type Product = { kode_produk: string; item_name: string | null; product_type: string | null; our_price: number | null; units: number | null; sales: number | null; stores: number | null;
  links: number; min_price: number | null; last_scraped: string | null };
type Listing = { refreshed_at: string | null; categories: string[]; total: number; rows: Product[] };
type LinkRow = { id: string; kode_produk: string; platform: Platform; store_name: string | null; store_url: string | null; product_url: string; note: string | null };
type RunInfo = { id: string; platform: Platform; status: "running" | "done" | "failed"; scraped: number; failed: number; error: string | null; started_at: string; links: number };
type Snap = { id: number; link_id: string; scraped_at: string; ok: boolean; error: string | null; price: number | null; original_price: number | null; sold: number | null; rating: number | null; title: string | null };

const PAGE = 100;
const rp = (n: number | null | undefined) => n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID");
const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.v, p.label])) as Record<Platform, string>;

export default function PriceResearchPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [data, setData] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<Product | null>(null);
  const [allLinks, setAllLinks] = useState<{ id: string; platform: Platform }[]>([]);
  const [starting, setStarting] = useState(false);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [building, setBuilding] = useState(false);

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

  const [loadTick, setLoadTick] = useState(0);
  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    const { data: d, error } = await supabase.rpc("price_research_products", { p_client_id: clientId, p_q: q.trim() || null, p_category: category || null, p_linked: linkedOnly, p_limit: limit, p_offset: 0 });
    if (error) setMsg({ ok: false, text: error.message });
    setData((d as Listing) || null);
    const { data: l } = await supabase.from("price_research_links").select("id, platform").eq("client_id", clientId);
    setAllLinks((l as { id: string; platform: Platform }[]) || []);
    setLoading(false);
  }, [supabase, clientId, q, category, linkedOnly, limit]);
  useEffect(() => {
    const h = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(h);
  }, [load, q, loadTick]);

  // the product list is rebuilt from the sales data once a day (Super Admin / Admin open the page)
  useEffect(() => {
    if (!isAdmin || !clientId || !data) return;
    const stale = !data.refreshed_at || Date.now() - new Date(data.refreshed_at).getTime() > 86_400_000;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stale && !building) { setBuilding(true); (async () => { await fetch("/api/price-research/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId }) }); setBuilding(false); load(); })(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, clientId, data?.refreshed_at]);

  const running = runs.filter((r) => r.status === "running");
  const busy = starting || running.length > 0;

  // the runs of this workspace: running ones are polled every 4 seconds (the server asks Apify and saves the prices when it has finished)
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
        setMsg({ ok: failed === 0, text: `Scrape finished: ${saved} price${saved === 1 ? "" : "s"} saved${failed ? ` · ${failed} failed (open the product to see why)` : ""}` });
        setLoadTick((t) => t + 1);
      }
    }, 4000);
    return () => clearInterval(h);
  }, [running.length, pollRuns]);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);

  async function scrape(ids: string[], label: string) {
    if (!ids.length) { setMsg({ ok: false, text: "No competitor links to scrape yet." }); return false; }
    const counts: Partial<Record<Platform, number>> = {};
    for (const id of ids) { const p = allLinks.find((l) => l.id === id)?.platform; if (p) counts[p] = (counts[p] || 0) + 1; }
    if (!window.confirm(`Scrape ${ids.length} competitor price${ids.length === 1 ? "" : "s"} (${label}) now?\nEstimated Apify cost: about US$ ${estimateCost(counts).toFixed(2)}.\nIt runs on Apify and takes a few minutes; you can keep working.`)) return false;
    setStarting(true); setMsg(null);
    const res = await fetch("/api/price-research/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link_ids: ids }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setStarting(false); setMsg({ ok: false, text: j.error || `Scrape failed (${res.status})` }); return false; }
    await pollRuns();
    setStarting(false);
    if (j.failed) setMsg({ ok: false, text: `${j.failed} link${j.failed === 1 ? "" : "s"} could not start: ${(j.errors || []).join(" | ")}` });
    return true;
  }

  const rows = data?.rows || [];
  const pill = (on: boolean): React.CSSProperties => ({ padding: "9px 18px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700,
    border: on ? "1px solid var(--gold)" : "1px solid rgba(255,255,255,.1)", background: on ? "rgba(201,162,39,.15)" : "rgba(10,22,40,.5)", color: on ? "var(--gold)" : "#e8edf8" });

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
          <div>
            <h3 style={{ margin: 0 }}>Price Research</h3>
            <div className="hint">Our products against competitor stores — Shopee, Tokopedia and TikTok Shop. Open a product to connect the competitor store and product URLs; prices are scraped only when you press Scrape.</div>
          </div>
          {isAdmin && (
            <button className="btn-gold" disabled={busy || !allLinks.length} onClick={() => scrape(allLinks.map((l) => l.id), "all linked products")} style={{ padding: "10px 22px" }}>
              {busy ? "Scraping on Apify…" : `Scrape all linked (${allLinks.length})`}
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", margin: "14px 0" }}>
          <div className="fld" style={{ minWidth: 280, flex: 1 }}><label>Search</label><input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Product ID or product name" /></div>
          <div className="fld" style={{ minWidth: 180 }}><label>Category</label>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setLimit(PAGE); }}>
              <option value="">All categories</option>
              {(data?.categories || []).sort().map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={pill(!linkedOnly)} onClick={() => setLinkedOnly(false)}>All products</button>
            <button style={pill(linkedOnly)} onClick={() => setLinkedOnly(true)}>With competitors ({allLinks.length ? new Set(rows.filter((r) => r.links > 0).map((r) => r.kode_produk)).size || "…" : 0})</button>
          </div>
        </div>
        {running.length > 0 && (
          <div style={{ color: "var(--gold)", fontSize: 13, marginBottom: 10 }}>
            ⏳ Scraping on Apify: {running.map((r) => `${PLATFORM_LABEL[r.platform]} · ${r.links} link${r.links === 1 ? "" : "s"} · ${Math.max(0, Math.round((now - new Date(r.started_at).getTime()) / 1000))}s`).join("   |   ")} — the prices appear here when it finishes (usually 1 to 5 minutes).
          </div>
        )}
        {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", fontSize: 13, marginBottom: 10 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}

        {!data ? <Loader center /> : (
          <>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
              {data.total.toLocaleString("id-ID")} products{data.refreshed_at ? ` · list updated ${fmtDateTime(data.refreshed_at)}` : " · the product list has not been built yet"}
              {(loading || building) && (building ? " · building the product list (about 20 seconds)…" : " · loading…")}
            </div>
            <div className="tbl-wrap" style={{ maxHeight: "66vh" }}>
              <table className="tbl day-tbl">
                <thead><tr>
                  <th>Product ID</th><th>Product</th><th>Category</th><th className="num">Our price (avg)</th><th className="num">Units · 120 d</th>
                  <th className="num">Competitors</th><th className="num">Lowest competitor</th><th className="num">Our price vs lowest</th><th>Last scraped</th><th></th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const gap = r.our_price && r.min_price ? (r.our_price / r.min_price - 1) * 100 : null;
                    return (
                      <tr key={r.kode_produk} onClick={() => setOpen(r)} style={{ cursor: "pointer" }}>
                        <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.kode_produk}</td>
                        <td style={{ minWidth: 240, maxWidth: 380, whiteSpace: "normal", overflowWrap: "anywhere" }}>{r.item_name}</td>
                        <td>{r.product_type || "—"}</td>
                        <td className="num">{rp(r.our_price)}</td>
                        <td className="num">{r.units == null ? "—" : Math.round(r.units).toLocaleString("id-ID")}</td>
                        <td className="num">{r.links ? <b style={{ color: "var(--gold)" }}>{r.links}</b> : <span style={{ color: "var(--muted)" }}>0</span>}</td>
                        <td className="num">{rp(r.min_price)}</td>
                        <td className="num" style={{ fontWeight: 700, color: gap == null ? "var(--muted)" : gap > 5 ? "#f87171" : gap < -1 ? "#86efac" : undefined }}>
                          {gap == null ? "—" : `${gap > 0 ? "+" : ""}${gap.toFixed(1)}%`}
                        </td>
                        <td>{r.last_scraped ? fmtDate(r.last_scraped) : "—"}</td>
                        <td><button className="btn-ghost" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>{r.links ? "Manage" : "+ Competitors"}</button></td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{data.refreshed_at ? "No product matches." : "Building the product list…"}</td></tr>}
                </tbody>
              </table>
              {data.total > rows.length && (
                <div style={{ textAlign: "center", padding: 12 }}><button className="btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, data.total - rows.length)} more ({data.total - rows.length} left)</button></div>
              )}
            </div>
          </>
        )}
      </div>

      {open && clientId && <LinksModal supabase={supabase} clientId={clientId} product={open} isAdmin={isAdmin} busy={busy} onScrape={scrape} onClose={() => { setOpen(null); load(); }} />}
    </>
  );
}

/* ── competitor links of one SKU, with the scraped prices ── */
function LinksModal({ supabase, clientId, product, isAdmin, busy, onScrape, onClose }: {
  supabase: ReturnType<typeof createClient>; clientId: string; product: Product; isAdmin: boolean; busy: boolean;
  onScrape: (ids: string[], label: string) => Promise<boolean>; onClose: () => void;
}) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [f, setF] = useState({ platform: "shopee" as Platform, store_name: "", store_url: "", product_url: "", note: "" });
  const [err, setErr] = useState("");
  const [hist, setHist] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: l } = await supabase.from("price_research_links").select("id, kode_produk, platform, store_name, store_url, product_url, note").eq("client_id", clientId).eq("kode_produk", product.kode_produk).order("created_at");
    const ls = (l as LinkRow[]) || [];
    setLinks(ls);
    if (ls.length) {
      const { data: s } = await supabase.from("price_research_snapshots").select("id, link_id, scraped_at, ok, error, price, original_price, sold, rating, title").in("link_id", ls.map((x) => x.id)).order("scraped_at", { ascending: false }).limit(500);
      setSnaps((s as Snap[]) || []);
    } else setSnaps([]);
  }, [supabase, clientId, product.kode_produk]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, busy]);   // reloads when a scrape starts or finishes

  async function add() {
    setErr("");
    const url = cleanUrl(f.product_url);
    if (!urlMatchesPlatform(f.platform, url)) { setErr(`The product URL must be a ${PLATFORM_LABEL[f.platform]} link (${PLATFORMS.find((p) => p.v === f.platform)?.hint}).`); return; }
    if (f.store_url.trim() && !/^https?:\/\//i.test(f.store_url.trim())) { setErr("The store URL must start with https://"); return; }
    const { error } = await supabase.from("price_research_links").insert({
      client_id: clientId, kode_produk: product.kode_produk, product_name: product.item_name, platform: f.platform,
      store_name: f.store_name.trim() || null, store_url: f.store_url.trim() || null, product_url: url, note: f.note.trim() || null,
    });
    if (error) { setErr(error.code === "23505" ? "This product URL is already connected to this SKU." : error.message); return; }
    setF({ ...f, store_name: "", store_url: "", product_url: "", note: "" });
    load();
  }
  async function del(l: LinkRow) { if (window.confirm("Remove this competitor link and its price history?")) { await supabase.from("price_research_links").delete().eq("id", l.id); load(); } }

  const latest = (id: string) => snaps.find((s) => s.link_id === id);                 // newest scrape (good or failed)
  const lastGood = (id: string) => snaps.find((s) => s.link_id === id && s.ok);
  const goods = links.map((l) => lastGood(l.id)?.price).filter((p): p is number => !!p && p > 0);
  const lowest = goods.length ? Math.min(...goods) : null;

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(2,6,16,.72)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(13,26,54,.98)", border: "1px solid rgba(201,162,39,.28)", borderRadius: 18, padding: 22, width: "min(1060px, 100%)", boxShadow: "0 30px 80px rgba(0,0,0,.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{product.item_name}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              <span style={{ fontFamily: "monospace" }}>{product.kode_produk}</span> · {product.product_type || "—"} · our price (avg) <b style={{ color: "var(--gold)" }}>{rp(product.our_price)}</b>
              {lowest != null && <> · lowest competitor <b style={{ color: "#e8edf8" }}>{rp(lowest)}</b>{product.our_price ? <> ({((product.our_price / lowest - 1) * 100).toFixed(1)}%)</> : null}</>}
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose} style={{ alignSelf: "flex-start" }}>✕ Close</button>
        </div>

        <div className="tbl-wrap" style={{ maxHeight: "38vh" }}>
          <table className="tbl day-tbl">
            <thead><tr><th>Marketplace</th><th>Competitor store</th><th>Product</th><th className="num">Price</th><th className="num">Original</th><th className="num">Sold</th><th className="num">Rating</th><th>Scraped</th><th></th></tr></thead>
            <tbody>
              {links.map((l) => {
                const g = lastGood(l.id), last = latest(l.id);
                return (
                  <tr key={l.id}>
                    <td><b>{PLATFORM_LABEL[l.platform]}</b></td>
                    <td style={{ whiteSpace: "normal" }}>{l.store_url ? <a href={l.store_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--gold)" }}>{l.store_name || l.store_url}</a> : (l.store_name || "—")}</td>
                    <td style={{ maxWidth: 300, whiteSpace: "normal", overflowWrap: "anywhere" }}><a href={l.product_url} target="_blank" rel="noopener noreferrer" style={{ color: "#cfe0ff" }}>{g?.title || l.product_url}</a>{l.note ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{l.note}</div> : null}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{rp(g?.price)}</td>
                    <td className="num">{rp(g?.original_price)}</td>
                    <td className="num">{g?.sold == null ? "—" : g.sold.toLocaleString("id-ID")}</td>
                    <td className="num">{g?.rating ?? "—"}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {g ? fmtDateTime(g.scraped_at) : "never"}
                      {last && !last.ok && <div style={{ color: "#f87171", fontSize: 11.5 }}>last try failed: {last.error}</div>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn-ghost" onClick={() => setHist(hist === l.id ? null : l.id)}>History</button>{" "}
                      {isAdmin && <button className="btn-ghost" disabled={busy} onClick={async () => { if (await onScrape([l.id], "1 link")) load(); }}>Scrape</button>}{" "}
                      {isAdmin && <button className="btn-ghost" onClick={() => del(l)} style={{ color: "#f87171" }}>✕</button>}
                    </td>
                  </tr>
                );
              })}
              {links.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No competitor connected to this SKU yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {hist && (
          <div style={{ margin: "10px 0", fontSize: 12.5 }}>
            <b>Price history</b>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
              {snaps.filter((s) => s.link_id === hist && s.ok).map((s) => <span key={s.id} style={{ color: "var(--muted)" }}>{fmtDate(s.scraped_at)} · <b style={{ color: "#e8edf8" }}>{rp(s.price)}</b></span>)}
              {snaps.filter((s) => s.link_id === hist && s.ok).length === 0 && <span style={{ color: "var(--muted)" }}>no price saved yet</span>}
            </div>
          </div>
        )}

        {isAdmin && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <div className="fld" style={{ minWidth: 140 }}><label>Marketplace</label>
                <select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value as Platform })}>{PLATFORMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}</select>
              </div>
              <div className="fld" style={{ minWidth: 150, flex: "1 1 150px" }}><label>Competitor store name</label><input value={f.store_name} onChange={(e) => setF({ ...f, store_name: e.target.value })} placeholder="e.g. Toko Rival AC" /></div>
              <div className="fld" style={{ minWidth: 200, flex: "1 1 200px" }}><label>Store URL</label><input value={f.store_url} onChange={(e) => setF({ ...f, store_url: e.target.value })} placeholder="https://shopee.co.id/rival_shop" /></div>
              <div className="fld" style={{ minWidth: 240, flex: "2 1 240px" }}><label>Product URL (their same SKU)</label><input value={f.product_url} onChange={(e) => setF({ ...f, product_url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={PLATFORMS.find((p) => p.v === f.platform)?.hint} /></div>
              <button className="btn-gold" onClick={add} style={{ padding: "10px 20px" }}>+ Connect</button>
            </div>
            {err && <div style={{ color: "#f87171", fontSize: 12.5, marginTop: 8 }}>✗ {err}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn-gold" disabled={busy || !links.length} onClick={async () => { if (await onScrape(links.map((l) => l.id), "this product")) load(); }} style={{ padding: "10px 24px" }}>
                {busy ? "Scraping on Apify…" : `Scrape this product (${links.length})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
