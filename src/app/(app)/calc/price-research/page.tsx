"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { PLATFORMS, type Platform } from "@/lib/priceResearch";
import StoreConnections from "./StoreConnections";
import ScrapePanel from "./ScrapePanel";

export const dynamic = "force-dynamic";

// Price Calculator > Price Research
//   Price Guard   per product: the SRP first (Baseline), then every connected store: Price Input (the price before the shop's discount),
//                 Price Discount (what a buyer pays after it), promo labels, and Higher / Under / Same against the SRP.
//   Prod Connect  the log of store connections (SRP + Catalog + one store + one platform) and, per connection, a Product URL for every product of the SRP.
//   Product Catalog  the SRP log (SRP ID automatic | Date Create | Date Active | Total SKU) and, per SRP, its products: Product Name, Prod ID,
//                 Harga Beli (the calculator's Modal Produk), Harga SRP; typed by hand or imported from an XLS. The SRP in force feeds Price Guard,
//                 Product URL and the Massive Calculator.
// Prices are scraped ON DEMAND (the Scrape button of Price Guard: pick connections, Execute) through Apify.
type Supabase = ReturnType<typeof createClient>;
type RunInfo = { id: string; platform: Platform; status: "running" | "done" | "failed"; scraped: number; failed: number; error: string | null; started_at: string; links: number };
type GuardStore = { link_id: string; store: string; platform: Platform; product_url: string; scraped_at: string | null; ok: boolean | null; error: string | null;
  price_original: number | null; price_sell: number | null; discount_pct: number | null; labels: string[] | null };
type GuardProduct = { product_id: string; prod_id: string; product_name: string; srp: number | null; srp_id: string | null; scraped_at: string | null; stores: GuardStore[] };
type TabKey = "guard" | "urls";

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
  if (sell == null || !srp) return { text: srp ? "—" : "no Harga Jual", color: "var(--muted)" };
  const d = (sell / srp - 1) * 100;
  if (Math.abs(d) < 0.5) return { text: "Same", color: "var(--gold)" };
  return d < 0 ? { text: `Under ${d.toFixed(1)}%`, color: "#f87171" } : { text: `Higher +${d.toFixed(1)}%`, color: "#86efac" };
}

export default function PriceResearchPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<TabKey>("guard");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
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

  // Execute of the Scrape window: starts the scrape of every Product URL of the picked connections
  async function runScrape(connectionIds: string[]) {
    if (!connectionIds.length) return false;
    setStarting(true); setMsg(null);
    const res = await fetch("/api/price-research/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connection_ids: connectionIds }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setStarting(false); setMsg({ ok: false, text: j.error || `Scrape failed (${res.status})` }); return false; }
    await pollRuns();
    setStarting(false);
    if (j.failed) setMsg({ ok: false, text: `${j.failed} link${j.failed === 1 ? "" : "s"} could not start: ${(j.errors || []).join(" | ")}` });
    return true;
  }

  const subTab = (v: TabKey, label: string) => (
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
        <Link href="/calc" className="mode-tab">Perhitungan Harga</Link>
        <span className="mode-tab on">Price Research</span>
        <Link href="/calc/product-catalog" className="mode-tab">Product Catalog</Link>
        <Link href="/calc/marketplace-fee" className="mode-tab">Marketplace Fee</Link>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Price Research</h3>
            <div className="hint">Add your products and their prices in the <b>Product Catalog</b> page, connect them to the stores&apos; pages in <b>Prod Connect</b>, then scrape and read the result in <b>Price Guard</b>.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>{subTab("guard", "Price Guard")}{subTab("urls", "Prod Connect")}</div>
        {running.length > 0 && (
          <div style={{ color: "var(--gold)", fontSize: 13, marginBottom: 10 }}>
            ⏳ Scraping on Apify: {running.map((r) => `${PLATFORM_LABEL[r.platform]} · ${r.links} link${r.links === 1 ? "" : "s"} · ${Math.max(0, Math.round((now - new Date(r.started_at).getTime()) / 1000))}s`).join("   |   ")} — the prices appear when it finishes.
          </div>
        )}
        {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", fontSize: 13, marginBottom: 10 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}

        {clientId && tab === "guard" && <ScrapePanel supabase={supabase} clientId={clientId} isAdmin={isAdmin} tick={tick} busy={busy} onExecute={runScrape} detail={<GuardTab supabase={supabase} clientId={clientId} tick={tick} />} />}
        {clientId && tab === "urls" && <StoreConnections supabase={supabase} clientId={clientId} isAdmin={isAdmin} tick={tick} onChanged={() => setTick((t) => t + 1)} />}
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
                      <div style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)", fontFamily: "monospace" }}>{p.prod_id}{p.srp_id ? ` · ${p.srp_id}` : ""}</div>
                      {p.product_name}
                    </td>
                    <td style={{ fontWeight: 800, color: "var(--gold)" }}>Catalog</td>
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
              {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Nothing to compare yet. Add products in the Product Catalog, connect a store in Prod Connect, then press Scrape.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
        Price Input = the store&apos;s price before its discount. Price Discount = what a buyer pays after the discount (&quot;-&quot; when there is none). Status compares that price with the Harga Jual of the Catalog valid on the date. Personal vouchers (for example a VIP voucher) and checkout costs differ per buyer and are not public, so they are not included.
      </div>
    </>
  );
}
