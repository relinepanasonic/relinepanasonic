"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { PLATFORMS, cleanUrl, estimateCost, urlMatchesPlatform, type Platform } from "@/lib/priceResearch";

export const dynamic = "force-dynamic";

// Price Calculator > Price Research
//   Results    every scraped competitor price: date, store, our product, Price Original (crossed-out), Price Sell (what a buyer pays on the
//              page, after the shop's discount; personal vouchers such as a VIP voucher are not public), promo labels, status vs our SRP
//              (the SRP that was valid on the scrape date).
//   Products   our own products, entered by hand: SRP ID, product name, Prod ID, SRP price (every SRP change is logged), and per product
//              the competitor links (marketplace + store URL + product URL). Prices are scraped ON DEMAND through Apify.
type Supabase = ReturnType<typeof createClient>;
type SrpProduct = { id: string; prod_id: string; product_name: string; srp_id: string | null; price_srp: number | null; created_at: string };
type LinkRow = { id: string; kode_produk: string; platform: Platform; store_name: string | null; store_url: string | null; product_url: string; note: string | null };
type RunInfo = { id: string; platform: Platform; status: "running" | "done" | "failed"; scraped: number; failed: number; error: string | null; started_at: string; links: number };
type Snap = { id: number; link_id: string; scraped_at: string; ok: boolean; error: string | null; price: number | null; original_price: number | null; sold: number | null; rating: number | null;
  title: string | null; labels: string[] | null };
type Result = { id: number; scraped_at: string; platform: Platform; store: string | null; store_url: string | null; product_url: string; competitor_title: string | null;
  product_name: string | null; prod_id: string | null; price_original: number | null; price_sell: number | null; discount_pct: number | null; labels: string[] | null;
  seller_location: string | null; srp: number | null; srp_id: string | null };
type LogRow = { id: number; srp_id: string | null; price_srp: number | null; old_srp_id: string | null; old_price_srp: number | null; effective_from: string; changed_by: string | null; changed_at: string };

const rp = (n: number | null | undefined) => n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID");
const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.v, p.label])) as Record<Platform, string>;
const today = () => new Date().toISOString().slice(0, 10);

// Status vs SRP: is the competitor selling under, at or over our SRP?
function srpStatus(sell: number | null, srp: number | null): { text: string; color: string } {
  if (!sell || !srp) return { text: srp ? "—" : "no SRP", color: "var(--muted)" };
  const d = (sell / srp - 1) * 100;
  if (Math.abs(d) < 0.5) return { text: "At SRP", color: "var(--gold)" };
  return d < 0 ? { text: `Below SRP ${d.toFixed(1)}%`, color: "#f87171" } : { text: `Above SRP +${d.toFixed(1)}%`, color: "#86efac" };
}

export default function PriceResearchPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<"results" | "products">("results");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [allLinks, setAllLinks] = useState<{ id: string; platform: Platform; kode_produk: string }[]>([]);
  const [starting, setStarting] = useState(false);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);                       // reload everything after a scrape or an edit
  const [open, setOpen] = useState<SrpProduct | null>(null);

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
      const { data: l } = await supabase.from("price_research_links").select("id, platform, kode_produk").eq("client_id", clientId);
      setAllLinks((l as { id: string; platform: Platform; kode_produk: string }[]) || []);
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
        setMsg({ ok: failed === 0, text: `Scrape finished: ${saved} price${saved === 1 ? "" : "s"} saved${failed ? ` · ${failed} failed: ${[...done, ...bad].map((r) => r.error).find(Boolean) || "open the product to see why"}` : ""}` });
        setTick((t) => t + 1);
      }
    }, 4000);
    return () => clearInterval(h);
  }, [running.length, pollRuns]);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);

  async function scrape(ids: string[], label: string) {
    if (!ids.length) { setMsg({ ok: false, text: "No competitor links to scrape yet. Add them in the Products tab." }); return false; }
    const counts: Partial<Record<Platform, number>> = {};
    for (const id of ids) { const p = allLinks.find((l) => l.id === id)?.platform; if (p) counts[p] = (counts[p] || 0) + 1; }
    if (!window.confirm(`Scrape ${ids.length} competitor price${ids.length === 1 ? "" : "s"} (${label}) now?\nEstimated Apify cost: about US$ ${estimateCost(counts).toFixed(3)}.\nIt runs on Apify and takes about a minute; you can keep working.`)) return false;
    setStarting(true); setMsg(null);
    const res = await fetch("/api/price-research/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link_ids: ids }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setStarting(false); setMsg({ ok: false, text: j.error || `Scrape failed (${res.status})` }); return false; }
    await pollRuns();
    setStarting(false);
    if (j.failed) setMsg({ ok: false, text: `${j.failed} link${j.failed === 1 ? "" : "s"} could not start: ${(j.errors || []).join(" | ")}` });
    return true;
  }

  const subTab = (v: "results" | "products", label: string) => (
    <button onClick={() => setTab(v)} style={{ padding: "9px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700,
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
            <div className="hint">Competitor prices against our SRP — Shopee, Tokopedia and TikTok Shop. Enter our products and their competitor links in <b>Products</b>; scrape when you need it.</div>
          </div>
          {isAdmin && (
            <button className="btn-gold" disabled={busy || !allLinks.length} onClick={() => scrape(allLinks.map((l) => l.id), "all competitor links")} style={{ padding: "10px 22px" }}>
              {busy ? "Scraping on Apify…" : `Scrape all (${allLinks.length})`}
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>{subTab("results", "Results")}{subTab("products", "Products")}</div>
        {running.length > 0 && (
          <div style={{ color: "var(--gold)", fontSize: 13, marginBottom: 10 }}>
            ⏳ Scraping on Apify: {running.map((r) => `${PLATFORM_LABEL[r.platform]} · ${r.links} link${r.links === 1 ? "" : "s"} · ${Math.max(0, Math.round((now - new Date(r.started_at).getTime()) / 1000))}s`).join("   |   ")} — the prices appear when it finishes.
          </div>
        )}
        {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", fontSize: 13, marginBottom: 10 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}

        {clientId && tab === "results" && <ResultsTab supabase={supabase} clientId={clientId} tick={tick} />}
        {clientId && tab === "products" && <ProductsTab supabase={supabase} clientId={clientId} isAdmin={isAdmin} tick={tick} links={allLinks} onOpen={setOpen} onChanged={() => setTick((t) => t + 1)} />}
      </div>

      {open && clientId && <LinksModal supabase={supabase} clientId={clientId} product={open} isAdmin={isAdmin} busy={busy} onScrape={scrape} onClose={() => { setOpen(null); setTick((t) => t + 1); }} />}
    </>
  );
}

/* ── Results: every scraped price ── */
function ResultsTab({ supabase, clientId, tick }: { supabase: Supabase; clientId: string; tick: number }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [latest, setLatest] = useState(true);
  const [rows, setRows] = useState<Result[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("price_research_results", { p_client_id: clientId, p_from: from || null, p_to: to || null, p_q: q.trim() || null, p_latest: latest });
    setErr(error ? error.message : "");
    setRows((data as Result[]) || []);
  }, [supabase, clientId, from, to, q, latest]);
  useEffect(() => { const h = setTimeout(load, q ? 300 : 0); return () => clearTimeout(h); }, [load, q, tick]);

  const pill = (on: boolean): React.CSSProperties => ({ padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700,
    border: on ? "1px solid var(--gold)" : "1px solid rgba(255,255,255,.1)", background: on ? "rgba(201,162,39,.15)" : "rgba(10,22,40,.5)", color: on ? "var(--gold)" : "#e8edf8" });

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div className="fld" style={{ minWidth: 150 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ colorScheme: "dark" }} /></div>
        <div className="fld" style={{ minWidth: 150 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ colorScheme: "dark" }} /></div>
        <div className="fld" style={{ minWidth: 260, flex: 1 }}><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product, Prod ID or store" /></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={pill(latest)} onClick={() => setLatest(true)}>Latest price per store</button>
          <button style={pill(!latest)} onClick={() => setLatest(false)}>Every scrape</button>
        </div>
      </div>
      {err && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 10 }}>✗ {err}</div>}
      {rows === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "66vh" }}>
          <table className="tbl day-tbl">
            <thead><tr>
              <th>Date</th><th>Store</th><th>Product Name</th><th className="num">Price Original</th><th className="num">Price Sell</th><th>Promo Labels</th><th className="num">SRP</th><th>Status vs SRP</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const st = srpStatus(r.price_sell, r.srp);
                const disc = r.price_original && r.price_sell && r.price_original > r.price_sell;
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.scraped_at)}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {r.store_url ? <a href={r.store_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--gold)" }}>{r.store || "—"}</a> : (r.store || "—")}
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{PLATFORM_LABEL[r.platform]}{r.seller_location ? ` · ${r.seller_location}` : ""}</div>
                    </td>
                    <td style={{ minWidth: 220, maxWidth: 360, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                      {r.product_name || <span style={{ color: "#fbbf24" }}>not in Products</span>}
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.prod_id ? `${r.prod_id} · ` : ""}<a href={r.product_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--muted)" }}>{r.competitor_title || "their page"}</a></div>
                    </td>
                    <td className="num" style={disc ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>{rp(r.price_original)}</td>
                    <td className="num" style={{ fontWeight: 800 }}>{rp(r.price_sell)}{r.discount_pct ? <div style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>−{Math.round(r.discount_pct)}%</div> : null}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 220 }}>{r.labels?.length ? r.labels.map((l) => <span key={l} style={{ display: "inline-block", margin: "0 4px 4px 0", padding: "2px 8px", borderRadius: 999, fontSize: 11, border: "1px solid rgba(201,162,39,.4)", color: "var(--gold)" }}>{l}</span>) : "—"}</td>
                    <td className="num">{rp(r.srp)}{r.srp_id ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.srp_id}</div> : null}</td>
                    <td style={{ whiteSpace: "nowrap", fontWeight: 700, color: st.color }}>{st.text}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No scraped price yet. Add products and competitor links in Products, then press Scrape.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>Price Sell = what any buyer sees on the page (after the shop&apos;s discount). Personal vouchers (e.g. a VIP voucher) and checkout costs are different per buyer and are not public, so they are not included.</div>
    </>
  );
}

/* ── Products: our products with their SRP (manual), and their competitor links ── */
function ProductsTab({ supabase, clientId, isAdmin, tick, links, onOpen, onChanged }: {
  supabase: Supabase; clientId: string; isAdmin: boolean; tick: number; links: { id: string; platform: Platform; kode_produk: string }[];
  onOpen: (p: SrpProduct) => void; onChanged: () => void;
}) {
  const [rows, setRows] = useState<SrpProduct[] | null>(null);
  const [lastScrape, setLastScrape] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<SrpProduct> | null>(null);
  const [logOf, setLogOf] = useState<SrpProduct | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("pr_srp_products").select("id, prod_id, product_name, srp_id, price_srp, created_at").eq("client_id", clientId).order("created_at");
      setRows((data as SrpProduct[]) || []);
      const { data: s } = await supabase.from("price_research_snapshots").select("link_id, scraped_at").eq("client_id", clientId).eq("ok", true).order("scraped_at", { ascending: false }).limit(3000);
      const m: Record<string, string> = {};
      for (const x of (s as { link_id: string; scraped_at: string }[]) || []) if (!m[x.link_id]) m[x.link_id] = x.scraped_at;
      setLastScrape(m);
    })();
  }, [supabase, clientId, tick]);

  const shown = (rows || []).filter((r) => { const t = q.trim().toLowerCase(); return !t || r.product_name.toLowerCase().includes(t) || r.prod_id.toLowerCase().includes(t) || (r.srp_id || "").toLowerCase().includes(t); });
  async function del(p: SrpProduct) {
    if (!window.confirm(`Delete ${p.product_name}? Its competitor links and their scraped prices are deleted too.`)) return;
    await supabase.from("price_research_links").delete().eq("client_id", clientId).eq("kode_produk", p.prod_id);
    await supabase.from("pr_srp_products").delete().eq("id", p.id);
    onChanged();
  }

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div className="fld" style={{ minWidth: 260, flex: 1 }}><label>Search</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product name, Prod ID or SRP ID" /></div>
        {isAdmin && <button className="btn-gold" onClick={() => setEdit({})} style={{ padding: "10px 22px" }}>+ Add product</button>}
      </div>
      {rows === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "66vh" }}>
          <table className="tbl day-tbl">
            <thead><tr><th className="num">No</th><th>SRP ID</th><th>Product Name</th><th>Prod ID</th><th className="num">Price SRP</th><th className="num">Competitors</th><th>Last scraped</th><th></th></tr></thead>
            <tbody>
              {shown.map((r, i) => {
                const ls = links.filter((l) => l.kode_produk === r.prod_id);
                const last = ls.map((l) => lastScrape[l.id]).filter(Boolean).sort().pop();
                return (
                  <tr key={r.id}>
                    <td className="num">{i + 1}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.srp_id || "—"}</td>
                    <td style={{ minWidth: 220, maxWidth: 380, whiteSpace: "normal", overflowWrap: "anywhere" }}>{r.product_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.prod_id}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{rp(r.price_srp)}</td>
                    <td className="num">{ls.length ? <b style={{ color: "var(--gold)" }}>{ls.length}</b> : <span style={{ color: "var(--muted)" }}>0</span>}</td>
                    <td>{last ? fmtDate(last) : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn-ghost" onClick={() => onOpen(r)}>{ls.length ? "Competitors" : "+ Competitors"}</button>{" "}
                      <button className="btn-ghost" onClick={() => setLogOf(r)}>SRP log</button>{" "}
                      {isAdmin && <button className="btn-ghost" onClick={() => setEdit(r)}>Edit</button>}{" "}
                      {isAdmin && <button className="btn-ghost" onClick={() => del(r)} style={{ color: "#f87171" }}>✕</button>}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{rows.length ? "No product matches." : "No product yet — press + Add product."}</td></tr>}
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
        {isNew ? "The first SRP is logged from the date above." : srpChanged ? <span style={{ color: "var(--gold)" }}>The SRP changes: the old SRP stays in the log, and the new one counts from the date above (scrapes before that date keep comparing with the old SRP).</span> : "Changing the SRP ID or the price adds a line to the SRP log."}
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
                  <td>{fmtDate(r.effective_from)}</td><td style={{ fontFamily: "monospace" }}>{r.srp_id || "—"}</td><td className="num" style={{ fontWeight: 700 }}>{rp(r.price_srp)}</td>
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

/* ── competitor links of one product, with the scraped prices ── */
function LinksModal({ supabase, clientId, product, isAdmin, busy, onScrape, onClose }: {
  supabase: Supabase; clientId: string; product: SrpProduct; isAdmin: boolean; busy: boolean;
  onScrape: (ids: string[], label: string) => Promise<boolean>; onClose: () => void;
}) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [f, setF] = useState({ platform: "shopee" as Platform, store_name: "", store_url: "", product_url: "", note: "" });
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data: l } = await supabase.from("price_research_links").select("id, kode_produk, platform, store_name, store_url, product_url, note").eq("client_id", clientId).eq("kode_produk", product.prod_id).order("created_at");
    const ls = (l as LinkRow[]) || [];
    setLinks(ls);
    if (ls.length) {
      const { data: s } = await supabase.from("price_research_snapshots").select("id, link_id, scraped_at, ok, error, price, original_price, sold, rating, title, labels").in("link_id", ls.map((x) => x.id)).order("scraped_at", { ascending: false }).limit(500);
      setSnaps((s as Snap[]) || []);
    } else setSnaps([]);
  }, [supabase, clientId, product.prod_id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, busy]);   // reloads when a scrape starts or finishes

  async function add() {
    setErr("");
    const url = cleanUrl(f.product_url);
    if (!urlMatchesPlatform(f.platform, url)) { setErr(`The product URL must be a ${PLATFORM_LABEL[f.platform]} link (${PLATFORMS.find((p) => p.v === f.platform)?.hint}).`); return; }
    if (f.store_url.trim() && !/^https?:\/\//i.test(f.store_url.trim())) { setErr("The store URL must start with https://"); return; }
    const { error } = await supabase.from("price_research_links").insert({
      client_id: clientId, kode_produk: product.prod_id, product_name: product.product_name, platform: f.platform,
      store_name: f.store_name.trim() || null, store_url: f.store_url.trim() || null, product_url: url, note: f.note.trim() || null,
    });
    if (error) { setErr(error.code === "23505" ? "This product URL is already connected to this product." : error.message); return; }
    setF({ ...f, store_name: "", store_url: "", product_url: "", note: "" });
    load();
  }
  async function del(l: LinkRow) { if (window.confirm("Remove this competitor link and its price history?")) { await supabase.from("price_research_links").delete().eq("id", l.id); load(); } }

  const latest = (id: string) => snaps.find((s) => s.link_id === id);
  const lastGood = (id: string) => snaps.find((s) => s.link_id === id && s.ok);

  return (
    <Modal onClose={onClose} width={1080}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{product.product_name}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}><span style={{ fontFamily: "monospace" }}>{product.prod_id}</span> · SRP <b style={{ color: "var(--gold)" }}>{rp(product.price_srp)}</b>{product.srp_id ? ` (${product.srp_id})` : ""}</div>
        </div>
        <button className="btn-ghost" onClick={onClose} style={{ alignSelf: "flex-start" }}>✕ Close</button>
      </div>
      <div className="tbl-wrap" style={{ maxHeight: "40vh" }}>
        <table className="tbl day-tbl">
          <thead><tr><th>Marketplace</th><th>Store</th><th>Their product</th><th className="num">Price Original</th><th className="num">Price Sell</th><th>Status vs SRP</th><th>Scraped</th><th></th></tr></thead>
          <tbody>
            {links.map((l) => {
              const g = lastGood(l.id), last = latest(l.id);
              const st = srpStatus(g?.price ?? null, product.price_srp);
              return (
                <tr key={l.id}>
                  <td><b>{PLATFORM_LABEL[l.platform]}</b></td>
                  <td style={{ whiteSpace: "normal" }}>{l.store_url ? <a href={l.store_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--gold)" }}>{l.store_name || l.store_url}</a> : (l.store_name || "—")}</td>
                  <td style={{ maxWidth: 280, whiteSpace: "normal", overflowWrap: "anywhere" }}><a href={l.product_url} target="_blank" rel="noopener noreferrer" style={{ color: "#cfe0ff" }}>{g?.title || l.product_url}</a></td>
                  <td className="num">{rp(g?.original_price ?? g?.price)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{rp(g?.price)}</td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700, color: st.color }}>{g ? st.text : "—"}</td>
                  <td style={{ whiteSpace: "normal" }}>{g ? fmtDateTime(g.scraped_at) : "never"}{last && !last.ok && <div style={{ color: "#f87171", fontSize: 11.5 }}>last try failed: {last.error}</div>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {isAdmin && <button className="btn-ghost" disabled={busy} onClick={async () => { if (await onScrape([l.id], "1 link")) load(); }}>Scrape</button>}{" "}
                    {isAdmin && <button className="btn-ghost" onClick={() => del(l)} style={{ color: "#f87171" }}>✕</button>}
                  </td>
                </tr>
              );
            })}
            {links.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No competitor connected to this product yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {isAdmin && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <div className="fld" style={{ minWidth: 140 }}><label>Marketplace</label>
              <select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value as Platform })}>{PLATFORMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}</select>
            </div>
            <div className="fld" style={{ minWidth: 150, flex: "1 1 150px" }}><label>Store name</label><input value={f.store_name} onChange={(e) => setF({ ...f, store_name: e.target.value })} placeholder="e.g. SM.Elektro" /></div>
            <div className="fld" style={{ minWidth: 200, flex: "1 1 200px" }}><label>Store URL</label><input value={f.store_url} onChange={(e) => setF({ ...f, store_url: e.target.value })} placeholder="https://shopee.co.id/sm.elektro" /></div>
            <div className="fld" style={{ minWidth: 240, flex: "2 1 240px" }}><label>Product URL (their same product)</label><input value={f.product_url} onChange={(e) => setF({ ...f, product_url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={PLATFORMS.find((p) => p.v === f.platform)?.hint} /></div>
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
    </Modal>
  );
}
