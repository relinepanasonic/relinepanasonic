"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PLATFORMS, type Platform } from "@/lib/priceResearch";
import StoreConnections from "./StoreConnections";
import ScrapePanel from "./ScrapePanel";

export const dynamic = "force-dynamic";

// Price Calculator > Price Research
//   Price Guard   the scrape log; open a row for its result (our price against every connected store) with the XLS / PDF download. Super Admin scrapes.
//   Prod Connect  the log of store connections (SRP + Catalog + one store + one platform) and, per connection, a Product URL for every product of the SRP.
// Prices are scraped ON DEMAND (the Scrape button of Price Guard: pick connections, Execute) through Apify.
type RunInfo = { id: string; platform: Platform; status: "running" | "done" | "failed"; scraped: number; failed: number; error: string | null; started_at: string; links: number };
type TabKey = "guard" | "urls";

const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.v, p.label])) as Record<Platform, string>;

export default function PriceResearchPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuper, setIsSuper] = useState(false);        // only the Super Admin can scrape (it costs Apify credit)
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
      const role = (p as { role?: string } | null)?.role || "";
      setIsAdmin(["superadmin", "client_admin"].includes(role));
      setIsSuper(role === "superadmin");
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

        {clientId && tab === "guard" && <ScrapePanel supabase={supabase} clientId={clientId} canScrape={isSuper} tick={tick} busy={busy} onExecute={runScrape} />}
        {clientId && tab === "urls" && <StoreConnections supabase={supabase} clientId={clientId} isAdmin={isAdmin} tick={tick} onChanged={() => setTick((t) => t + 1)} />}
      </div>
    </>
  );
}
