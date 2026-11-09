"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { Modal } from "@/components/ProductCatalog";
import { PLATFORMS, estimateCost, type Platform } from "@/lib/priceResearch";
import { downloadScrapePdf } from "@/lib/scrapePdf";
import { sortByCategory, colLabels, colTitle, diffPct, downloadScrapeXls, oursOf, verdict, type Cell, type ResultData, type ScrapeConn } from "@/lib/scrapeResult";

// Price Research > Price Guard
//   First page: the scrape log only (one row per Execute) and the Scrape button.
//   Open a row of the log: the result of that scrape: Prod ID | Product Name | Our Price | one column per connected store
//   (red = cheaper than our price, green = more expensive than our price), with the XLS and PDF download.
// The Scrape button opens a window: pick the connections, see how many links will be scraped, Execute or Cancel.
type Supabase = ReturnType<typeof createClient>;
type ScrapeRow = { id: string; created_at: string; created_by: string | null; links: number; connections: ScrapeConn[]; status: "running" | "done" | "failed"; finished_at?: string | null; saved: number; failed: number };

// how long a Price Research took, from Execute to done (a running one counts up to now)
function took(s: ScrapeRow): string {
  const from = new Date(s.created_at).getTime();
  const to = s.finished_at ? new Date(s.finished_at).getTime() : s.status === "running" ? Date.now() : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "—";
  const sec = Math.max(0, Math.round((to - from) / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
  return h ? `${h}h ${m}m ${r}s` : m ? `${m}m ${r}s` : `${r}s`;
}
type ConnLog = { id: string; name: string | null; srp_no: string | null; catalog_no: string | null; vendor_name: string | null; store_name: string | null; platform: string | null };
type LinkLite = { id: string; connection_id: string | null; platform: Platform };

const MAX_LINKS = 600;
const RED = "#f87171", GREEN = "#86efac";
const rp = (n: number | null | undefined) => (n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function jkt(v: string) {
  const d = new Date(v); if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 3600_000);
}
function when(v: string): string {
  const j = jkt(v); if (!j) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(j.getUTCDate())} ${MON[j.getUTCMonth()]} ${j.getUTCFullYear()} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}
function stamp(v: string): string {
  const j = jkt(v); if (!j) return "check";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())}-${p(j.getUTCHours())}${p(j.getUTCMinutes())}`;
}

export default function ScrapePanel({ supabase, clientId, canScrape, tick, busy, onExecute }: {
  supabase: Supabase; clientId: string; canScrape: boolean; tick: number; busy: boolean;
  onExecute: (connectionIds: string[]) => Promise<boolean>;
}) {
  const [scrapes, setScrapes] = useState<ScrapeRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

  const loadLog = useCallback(async () => {
    const { data } = await supabase.rpc("pr_scrapes_log", { p_client_id: clientId });
    setScrapes((data as ScrapeRow[]) || []);
  }, [supabase, clientId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadLog(); }, [loadLog, tick]);
  // while a scrape runs the log keeps itself up to date
  const anyRunning = !!scrapes?.some((s) => s.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const h = setInterval(loadLog, 5000);
    return () => clearInterval(h);
  }, [anyRunning, loadLog]);

  const current = scrapes?.find((s) => s.id === open) ?? null;
  if (open && current) return <ResultPage supabase={supabase} scrape={current} tick={tick} onBack={() => setOpen(null)} />;

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div className="hint" style={{ flex: 1, margin: 0 }}>Every Price Research is in this log. Click a row to see its result against our prices.{canScrape ? " Press Price Research to start a new one." : ""}</div>
        {canScrape && <button className="btn-gold" disabled={busy} onClick={() => setModal(true)} style={{ padding: "10px 24px" }}>{busy ? "Price Research running…" : "Price Research"}</button>}
      </div>
      {scrapes === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "68vh" }}>
          <table className="tbl day-tbl">
            <thead><tr><th>Date</th><th>Connections</th><th className="num">Links</th><th className="num">Saved</th><th className="num">Failed</th><th>Status</th><th className="num">Time</th><th>Researched by</th></tr></thead>
            <tbody>
              {scrapes.map((s) => (
                <tr key={s.id} onClick={() => setOpen(s.id)} style={{ cursor: "pointer" }}>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{when(s.created_at)}</td>
                  <td style={{ maxWidth: 560 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {s.connections.slice(0, 3).map((c) => (
                        <span key={c.id} style={{ padding: "2px 10px", borderRadius: 999, fontSize: 12, border: "1px solid rgba(255,255,255,.14)", whiteSpace: "nowrap" }}>
                          <span style={{ fontFamily: "monospace", color: "var(--muted)" }}>{c.srp_no || "—"}</span> · {colTitle(c)}
                        </span>
                      ))}
                      {s.connections.length > 3 && <span style={{ color: "var(--muted)", fontSize: 12 }}>+{s.connections.length - 3} more</span>}
                    </div>
                  </td>
                  <td className="num">{s.links}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{s.saved}</td>
                  <td className="num" style={{ color: s.failed ? RED : undefined }}>{s.failed}</td>
                  <td>{s.status === "running" ? <span style={{ color: "var(--gold)" }}>⏳ Running</span> : s.status === "done" ? <span style={{ color: GREEN }}>Done</span> : <span style={{ color: RED }}>Failed</span>}</td>
                  <td className="num" style={{ whiteSpace: "nowrap", color: s.status === "running" ? "var(--gold)" : undefined }}>{took(s)}</td>
                  <td>{s.created_by || "—"}</td>
                </tr>
              ))}
              {scrapes.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No Price Research yet{canScrape ? " — press Price Research and pick the store connections." : "."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {modal && <ScrapeModal supabase={supabase} clientId={clientId} busy={busy} onClose={() => setModal(false)}
        onExecute={async (ids) => { const ok = await onExecute(ids); if (ok) { setModal(false); await loadLog(); } return ok; }} />}
    </>
  );
}

/* ── the result of one scrape ── */
function ResultPage({ supabase, scrape, tick, onBack }: { supabase: Supabase; scrape: ScrapeRow; tick: number; onBack: () => void }) {
  const [data, setData] = useState<ResultData | null>(null);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<"" | "xls" | "pdf">("");
  const running = scrape.status === "running";

  const load = useCallback(async () => {
    const { data: d } = await supabase.rpc("pr_scrape_result", { p_scrape: scrape.id });
    setData((d as ResultData) || { columns: [], rows: [] });
  }, [supabase, scrape.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, tick, scrape.status]);
  useEffect(() => {
    if (!running) return;
    const h = setInterval(load, 5000);
    return () => clearInterval(h);
  }, [running, load]);

  const t = q.trim().toLowerCase();
  const rows = sortByCategory(data?.rows || []).filter((r) => !t || r.product_name.toLowerCase().includes(t) || r.prod_id.toLowerCase().includes(t));
  const meta = { title: `Price Research of ${when(scrape.created_at)}`, by: scrape.created_by, status: scrape.status };
  async function download(kind: "xls" | "pdf") {
    if (!data) return;
    setSaving(kind);
    try {
      const all = { ...data, rows };      // what is on the screen (the search filter included)
      if (kind === "xls") await downloadScrapeXls(all, meta, stamp(scrape.created_at)); else await downloadScrapePdf(all, meta, stamp(scrape.created_at));
    } finally { setSaving(""); }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <button className="btn-ghost" onClick={onBack}>← Price Research log</button>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--gold)" }}>PROF TOKO ONLINE</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>Price Guard Project</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{meta.title}</div>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
          {scrape.created_by ? `researched by ${scrape.created_by} · ` : ""}{scrape.saved} saved{scrape.failed ? `, ${scrape.failed} failed` : ""} · {running ? <span style={{ color: "var(--gold)" }}>⏳ running, the prices appear as they arrive</span> : scrape.status === "done" ? "done" : <span style={{ color: RED }}>failed</span>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn-ghost" disabled={!data || !!saving} onClick={() => download("xls")}>{saving === "xls" ? "Preparing…" : "⬇ XLS"}</button>
          <button className="btn-ghost" disabled={!data || !!saving} onClick={() => download("pdf")}>{saving === "pdf" ? "Preparing…" : "⬇ PDF"}</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <div className="fld" style={{ minWidth: 240, flex: "0 1 340px" }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a product or Prod ID" /></div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span><b style={{ color: RED }}>Red</b>: cheaper than our price</span>
          <span><b style={{ color: GREEN }}>Green</b>: more expensive than our price</span>
        </div>
      </div>
      {data === null ? <Loader center /> : <ResultTable data={data} rows={rows} />}
    </>
  );
}

/* ── Prod ID | Product Name | Our Price | one column per store ── */
function ResultTable({ data, rows }: { data: ResultData; rows: ResultData["rows"] }) {
  const cols = data.columns;
  const labels = colLabels(cols);
  return (
    <div className="tbl-wrap" style={{ maxHeight: "66vh" }}>
      <table className="tbl day-tbl">
        <thead>
          <tr>
            <th>Prod ID</th><th>Category</th><th>Product Name</th><th className="num">Our Price</th>
            {cols.map((c) => (
              <th key={c.id} className="num" style={{ whiteSpace: "nowrap" }}>{labels.get(c.id)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ours = oursOf(r, cols);
            return (
              <tr key={r.prod_id}>
                <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.prod_id}</td>
                <td style={{ whiteSpace: "nowrap", fontSize: 12, color: "var(--gold)", fontWeight: 700 }}>{r.category || "—"}</td>
                <td style={{ minWidth: 220, maxWidth: 340, whiteSpace: "normal", overflowWrap: "anywhere", fontWeight: 700 }}>{r.product_name}</td>
                <td className="num" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                  {ours.length === 0 ? "—" : ours.length === 1 ? rp(ours[0].v) : ours.map((x) => <div key={x.platform || "x"}>{rp(x.v)} <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--muted)" }}>{x.platform}</span></div>)}
                </td>
                {cols.map((c) => <PriceCell key={c.id} cell={r.cells[c.id]} />)}
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={4 + cols.length} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No product with a Product URL in this scrape.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function PriceCell({ cell }: { cell?: Cell }) {
  const v = verdict(cell);
  if (v === "none") return <td className="num" style={{ color: "var(--muted)" }} title="This store does not sell it (no Product URL)">—</td>;
  if (v === "broken") return <td className="num" style={{ color: "#fb923c", fontSize: 12 }} title={cell!.error || "The link does not lead to a product"}>Broken link</td>;
  if (v === "noprice") return <td className="num" style={{ color: "#fbbf24", fontSize: 12 }} title={cell!.error || "The product page gave no price"}>No price found</td>;
  if (v === "pending") return <td className="num" style={{ color: "var(--muted)" }} title="No price saved yet">…</td>;
  const c = cell!;
  const d = diffPct(c.price!, c.ours);
  const color = v === "cheaper" ? RED : v === "pricier" ? GREEN : undefined;
  const tip = [c.discount_pct ? `Discount ${c.discount_pct}%` : "", c.labels?.length ? c.labels.join(", ") : ""].filter(Boolean).join(" · ");
  return (
    <td className="num" title={tip || undefined} style={{ whiteSpace: "nowrap", color, background: v === "cheaper" ? "rgba(248,113,113,.08)" : v === "pricier" ? "rgba(134,239,172,.07)" : undefined }}>
      <div style={{ fontWeight: 700 }}>{rp(c.price)}</div>
      {d != null && <div style={{ fontSize: 11, fontWeight: 400 }}>{d > 0 ? "+" : ""}{d.toFixed(1)}%</div>}
      {c.original != null && c.price != null && c.original > c.price && <div style={{ fontSize: 10.5, fontWeight: 400, color: "var(--muted)", textDecoration: "line-through" }}>{rp(c.original)}</div>}
    </td>
  );
}

/* ── Check prices: pick the connections, see the links, Execute / Cancel ── */
function ScrapeModal({ supabase, clientId, busy, onClose, onExecute }: {
  supabase: Supabase; clientId: string; busy: boolean; onClose: () => void; onExecute: (ids: string[]) => Promise<boolean>;
}) {
  const [conns, setConns] = useState<ConnLog[] | null>(null);
  const [links, setLinks] = useState<LinkLite[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: l }] = await Promise.all([
        supabase.rpc("pr_connections_log", { p_client_id: clientId }),
        supabase.from("price_research_links").select("id, connection_id, platform").eq("client_id", clientId),
      ]);
      setConns((c as ConnLog[]) || []); setLinks((l as LinkLite[]) || []);
    })();
  }, [supabase, clientId]);

  const countOf = useCallback((id: string) => links.filter((l) => l.connection_id === id).length, [links]);
  const usable = useMemo(() => (conns || []).filter((c) => countOf(c.id) > 0), [conns, countOf]);
  const chosen = links.filter((l) => l.connection_id && sel.has(l.connection_id));
  const byPlatform: Partial<Record<Platform, number>> = {};
  for (const l of chosen) byPlatform[l.platform] = (byPlatform[l.platform] || 0) + 1;
  const cost = estimateCost(byPlatform);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = usable.length > 0 && usable.every((c) => sel.has(c.id));

  async function execute() {
    setErr(""); setRunning(true);
    const ok = await onExecute([...sel]);
    setRunning(false);
    if (!ok) setErr("The Price Research could not start: see the message above the table.");
  }
  return (
    <Modal onClose={onClose} width={820}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Price Research</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>Pick the store connections to research. Every Product URL of a picked connection is researched; nothing starts before you press Execute.</div>
      {conns === null ? <Loader center /> : (
        <div className="tbl-wrap" style={{ maxHeight: "40vh" }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ width: 34 }}><input type="checkbox" title="Pick all" checked={allOn} onChange={(e) => setSel(e.target.checked ? new Set(usable.map((c) => c.id)) : new Set())} /></th>
              <th>Connection Name</th><th>SRP ID</th><th>Catalog ID</th><th>Store Name</th><th>Platform</th><th className="num">Links</th>
            </tr></thead>
            <tbody>
              {conns.map((c) => {
                const n = countOf(c.id);
                return (
                  <tr key={c.id} onClick={() => n && toggle(c.id)} style={{ cursor: n ? "pointer" : "not-allowed", opacity: n ? 1 : 0.5 }}>
                    <td><input type="checkbox" disabled={!n} checked={sel.has(c.id)} onChange={() => toggle(c.id)} onClick={(e) => e.stopPropagation()} /></td>
                    <td style={{ fontWeight: 700 }}>{c.name || <span style={{ color: "var(--muted)", fontWeight: 400 }}>{c.store_name || "—"}</span>}</td>
                    <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{c.srp_no || "—"}</td>
                    <td><span style={{ fontFamily: "monospace" }}>{c.catalog_no || "—"}</span>{c.vendor_name && <span style={{ color: "var(--muted)", fontSize: 12 }}> · {c.vendor_name}</span>}</td>
                    <td>{c.store_name || "—"}</td>
                    <td>{c.platform || "—"}</td>
                    <td className="num">{n ? n : <span style={{ color: "var(--muted)", fontSize: 12 }}>no Product URL yet</span>}</td>
                  </tr>
                );
              })}
              {conns.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No store connected yet. Connect a store in Prod Connect first.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(201,162,39,.35)", background: "rgba(201,162,39,.08)", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline" }}>
        <span><b style={{ fontSize: 20, color: "var(--gold-soft)" }}>{chosen.length}</b> link{chosen.length === 1 ? "" : "s"} will be researched</span>
        <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{sel.size} connection{sel.size === 1 ? "" : "s"}{chosen.length ? ` · estimated Apify cost about US$ ${cost.toFixed(3)}` : ""}</span>
        {chosen.length > MAX_LINKS && <span style={{ color: RED, fontSize: 12.5 }}>Too many links: pick fewer connections (max {MAX_LINKS} at a time).</span>}
        {PLATFORMS.filter((p) => byPlatform[p.v]).length > 0 && <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{PLATFORMS.filter((p) => byPlatform[p.v]).map((p) => `${p.label} ${byPlatform[p.v]}`).join(" · ")}</span>}
      </div>
      {err && <div style={{ color: RED, fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-gold" disabled={!chosen.length || chosen.length > MAX_LINKS || running || busy} onClick={execute} style={{ padding: "10px 28px" }}>
          {running ? "Starting…" : "Execute"}
        </button>
      </div>
    </Modal>
  );
}
