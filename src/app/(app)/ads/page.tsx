"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/* ── Constants ──────────────────────────────────────────────────────────── */
const MONTHS   = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS    = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
const THIS_YEAR = new Date().getFullYear();
const YEARS    = Array.from({ length: 6 }, (_, i) => THIS_YEAR - 2 + i);

/* ── Types ──────────────────────────────────────────────────────────────── */
type AdsRow = {
  store_name: string; city: string | null; grup_iklan: string;
  year: number | null; month: string | null; week: string | null;
  biaya: number; penjualan_langsung: number; omzet: number;
  roas: number | null; modal_harian: number | null;
};
type Filters = { years: number[]; months: string[]; weeks: string[]; cities: string[]; stores: string[]; grups: string[] };
const EMPTY_FILTERS: Filters = { years: [], months: [], weeks: [], cities: [], stores: [], grups: [] };

type Cell = { biaya: number; penj: number; omzet: number; modal: number | null };
type GroupRow = { store: string; grup: string; cells: Record<string, Cell>; total: Cell };

type DetailRow = {
  item_name: string; kode_produk: string | null; week: string | null;
  biaya: number; penjualan_langsung: number; omzet: number; roas: number | null;
};
type ProductPivot = {
  item_name: string; kode_produk: string | null;
  weeks: Record<string, { biaya: number; penj: number; roas: number | null }>;
  total: { biaya: number; penj: number };
};

/* ── Helpers ────────────────────────────────────────────────────────────── */
const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const idrShort = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1e9) return "Rp " + (v / 1e9).toFixed(1) + "M";
  if (Math.abs(v) >= 1e6) return "Rp " + (v / 1e6).toFixed(1) + "jt";
  if (Math.abs(v) >= 1e3) return "Rp " + (v / 1e3).toFixed(0) + "rb";
  return "Rp " + v;
};
const roasStr = (penj: number, biaya: number) => biaya > 0 ? (penj / biaya).toFixed(2) + "×" : "—";

function aggregateRows(list: AdsRow[]): Cell {
  return {
    biaya: list.reduce((s, r) => s + (r.biaya || 0), 0),
    penj:  list.reduce((s, r) => s + (r.penjualan_langsung || 0), 0),
    omzet: list.reduce((s, r) => s + (r.omzet || 0), 0),
    modal: (() => {
      const vals = list.map((r) => r.modal_harian).filter((m): m is number => m != null);
      return vals.length ? vals.reduce((s, m) => s + m, 0) : null;
    })(),
  };
}

/* ════════════════════════════════════════════════════════════════════════ */
export default function AdsPage() {
  const [supabase]  = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [userId,   setUserId]   = useState("");
  const [mounted,  setMounted]  = useState(false);

  // analysis
  const [rows,     setRows]     = useState<AdsRow[]>([]);
  const [filters,  setFilters]  = useState<Filters>(EMPTY_FILTERS);
  const [loading,  setLoading]  = useState(false);
  const [rpcError, setRpcError] = useState("");

  // analysis filters
  const [mode,     setMode]     = useState<"week" | "month">("week");
  const [fltYear,  setFltYear]  = useState("");
  const [fltMonth, setFltMonth] = useState("");
  const [fltStore, setFltStore] = useState("");
  const [fltGrup,  setFltGrup]  = useState("");

  // upload form
  const [cities,  setCities]   = useState<{ value: string; pic: string | null }[]>([]);
  const [dealers, setDealers]  = useState<string[]>([]);
  const [up, setUp] = useState({ city: "", dealer: "", year: THIS_YEAR, month: "", week: "", grup: "" });
  const [file, setFile]  = useState<File | null>(null);
  const [busy, setBusy]  = useState(false);
  const [log,  setLog]   = useState<string[]>([]);

  // tracks whether the month was auto-selected on first load.
  // When true, loadData won't override a user-cleared month selection.
  const monthLockedRef = useRef(false);

  // detail modal
  const [showDetail,    setShowDetail]    = useState(false);
  const [detailStore,   setDetailStore]   = useState("");
  const [detailGrup,    setDetailGrup]    = useState("");
  const [detailRows,    setDetailRows]    = useState<DetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError,   setDetailError]   = useState("");

  useEffect(() => { setMounted(true); }, []);

  /* ── load summary data ── */
  const loadData = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setRpcError("");
    try {
      const params: Record<string, unknown> = {};
      if (fltYear)                     params.p_year  = Number(fltYear);
      if (mode === "week" && fltMonth) params.p_month = fltMonth;
      if (fltStore)                    params.p_store = fltStore;
      if (fltGrup)                     params.p_grup  = fltGrup;

      const { data, error } = await supabase.rpc("ads_groups", params);
      if (error) {
        setRpcError(error.message);
      } else if (data) {
        const f = (data.filters as Filters) || EMPTY_FILTERS;
        setRows((data.rows as AdsRow[]) || []);
        setFilters(f);
        if (!fltYear && f.years.length) setFltYear(String(f.years[0]));
        // Only auto-select month on first load; never override a user-cleared selection.
        if (mode === "week" && !fltMonth && !monthLockedRef.current && f.months.length) {
          monthLockedRef.current = true;
          const present = MONTHS.filter((m) => f.months.includes(m));
          if (present.length) setFltMonth(present[present.length - 1]);
        }
      }
    } catch (e) {
      setRpcError(String(e));
    }
    setLoading(false);
  }, [supabase, fltYear, fltMonth, fltStore, fltGrup, mode]);

  /* ── initial load ── */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);
      const { data: cityRows } = await supabase.from("master_data")
        .select("value,pic").eq("kind", "city").eq("client_id", cid).order("value");
      setCities((cityRows as { value: string; pic: string | null }[]) || []);
    })();
  }, [supabase]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadData(); }, [loadData]);

  /* ── upload: city → dealers ── */
  async function pickCity(city: string) {
    setUp((u) => ({ ...u, city, dealer: "" }));
    if (!city || !clientId) { setDealers([]); return; }
    const { data } = await supabase.from("master_data")
      .select("value").eq("kind", "store").eq("client_id", clientId).eq("city", city).order("value");
    setDealers(((data as { value: string }[]) || []).map((d) => d.value));
  }

  async function submitUpload() {
    if (!file)            { setLog(["Pick an Ads file first."]); return; }
    if (!up.dealer)       { setLog(["Select a Dealer."]); return; }
    if (!up.grup.trim())  { setLog(["Enter the Grup Iklan name (one ad group per file)."]); return; }
    if (!up.month)        { setLog(["Select a Bulan."]); return; }
    if (!up.week)         { setLog(["Select a Week."]); return; }
    setBusy(true); setLog([]);
    const pic = cities.find((c) => c.value === up.city)?.pic || "";
    const manual = {
      admin: "", city: up.city, pic_client: pic, store_name: up.dealer,
      year: up.year, bulan: up.month, week: up.week, grup_iklan: up.grup.trim(),
    };
    const fd = new FormData();
    fd.append("file", file);
    fd.append("source", "ads");
    fd.append("manual", JSON.stringify(manual));
    fd.append("client_id", clientId);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      setLog([res.ok ? `✓ ${up.grup.trim()} · ${up.dealer} · ${up.month} ${up.week}: ${j.rows} rows` : `✗ ${j.error}`]);
      if (res.ok) { setFile(null); monthLockedRef.current = false; setFltMonth(""); setFltYear(""); }
    } catch (e) {
      setLog([`✗ ${String(e)}`]);
    }
    setBusy(false);
  }

  /* ── open detail modal ── */
  async function openDetail(store: string, grup: string) {
    setDetailStore(store);
    setDetailGrup(grup);
    setDetailRows([]);
    setDetailError("");
    setDetailLoading(true);
    setShowDetail(true);
    try {
      const params: Record<string, unknown> = { p_store: store, p_grup: grup };
      if (fltYear)                     params.p_year  = Number(fltYear);
      if (mode === "week" && fltMonth) params.p_month = fltMonth;
      const { data, error } = await supabase.rpc("ads_detail", params);
      if (error) setDetailError(error.message);
      else       setDetailRows((data as DetailRow[]) || []);
    } catch (e) {
      setDetailError(String(e));
    }
    setDetailLoading(false);
  }

  /* ── save Modal Harian ── */
  async function saveModal(store: string, grup: string, week: string, raw: string) {
    const val = raw.trim() === "" ? null : Number(raw.replace(/[^\d.-]/g, ""));
    if (raw.trim() !== "" && !Number.isFinite(val as number)) return;
    setRows((prev) => prev.map((r) =>
      r.store_name === store && r.grup_iklan === grup && r.month === fltMonth && r.week === week && r.year === Number(fltYear)
        ? { ...r, modal_harian: val } : r));
    await supabase.from("ads_budget").upsert({
      client_id: clientId, store_name: store, grup_iklan: grup,
      year: Number(fltYear), month: fltMonth, week, modal_harian: val,
      updated_by: userId || null, updated_at: new Date().toISOString(),
    }, { onConflict: "client_id,store_name,grup_iklan,year,month,week" });
  }

  /* ── pivot summary ── */
  const { groups, periods } = useMemo(() => {
    const periods = mode === "week"
      ? WEEKS.filter((w) => rows.some((r) => r.week === w))
      : MONTHS.filter((m) => rows.some((r) => r.month === m));
    const map = new Map<string, AdsRow[]>();
    for (const r of rows) {
      const k = `${r.store_name}|||${r.grup_iklan}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    const groups: GroupRow[] = [...map.entries()].map(([k, list]) => {
      const [store, grup] = k.split("|||");
      const cells: Record<string, Cell> = {};
      for (const p of periods) {
        const sub = list.filter((r) => (mode === "week" ? r.week : r.month) === p);
        cells[p] = aggregateRows(sub);
      }
      return { store, grup, cells, total: aggregateRows(list) };
    }).sort((a, b) => b.total.biaya - a.total.biaya);
    return { groups, periods };
  }, [rows, mode]);

  /* ── pivot detail rows for modal ── */
  const { detailPivot, detailWeeks } = useMemo(() => {
    const weekSet = new Set<string>();
    for (const r of detailRows) if (r.week) weekSet.add(r.week);
    const detailWeeks = WEEKS.filter((w) => weekSet.has(w));

    const map = new Map<string, ProductPivot>();
    for (const r of detailRows) {
      const key = `${r.item_name}|||${r.kode_produk ?? ""}`;
      if (!map.has(key)) map.set(key, { item_name: r.item_name, kode_produk: r.kode_produk, weeks: {}, total: { biaya: 0, penj: 0 } });
      const p = map.get(key)!;
      if (r.week) {
        p.weeks[r.week] = { biaya: r.biaya, penj: r.penjualan_langsung, roas: r.roas };
      }
      p.total.biaya += r.biaya;
      p.total.penj  += r.penjualan_langsung;
    }
    const detailPivot = [...map.values()].sort((a, b) => b.total.biaya - a.total.biaya);
    return { detailPivot, detailWeeks };
  }, [detailRows]);

  const grandTotal = useMemo(() => aggregateRows(rows), [rows]);

  /* ════════════════════════════════════════════════════════════════════ */

  /* ── Detail Modal ── */
  const detailModal = showDetail && mounted && createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(2,6,16,.92)", backdropFilter: "blur(10px)",
      display: "flex", flexDirection: "column", padding: 20,
    }}>
      {/* Modal header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#e8edf8", lineHeight: 1.2 }}>{detailStore}</div>
          <div style={{ fontSize: 13, color: "var(--gold)", marginTop: 3 }}>Grup Iklan: <strong>{detailGrup}</strong></div>
          {(fltMonth || fltYear) && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {[fltMonth, fltYear].filter(Boolean).join(" ")}
            </div>
          )}
        </div>
        <button onClick={() => setShowDetail(false)}
          style={{ padding: "8px 20px", borderRadius: 10, border: "1px solid rgba(201,162,39,.3)",
            background: "rgba(201,162,39,.08)", color: "var(--gold)", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
          ✕ Close
        </button>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "linear-gradient(90deg,transparent,rgba(201,162,39,.4),transparent)", marginBottom: 16 }} />

      {detailError && (
        <div style={{ padding: 12, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 10, color: "#fca5a5", fontSize: 13, marginBottom: 14, fontFamily: "monospace" }}>
          ⚠ {detailError}
        </div>
      )}

      {detailLoading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--muted)", fontSize: 14 }}>
          Loading product data…
        </div>
      ) : (
        <div style={{ overflow: "auto", flex: 1, borderRadius: 14, border: "1px solid var(--line)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              {/* Row 1: group headers */}
              <tr style={{ background: "#0f2040", position: "sticky", top: 0, zIndex: 2 }}>
                <th rowSpan={2} style={{ ...thS, minWidth: 110, borderRight: "1px solid rgba(255,255,255,.08)", textAlign: "left" }}>Kode Produk</th>
                <th rowSpan={2} style={{ ...thS, minWidth: 220, borderRight: "1px solid rgba(255,255,255,.08)", textAlign: "left" }}>Nama Iklan / Produk</th>
                {detailWeeks.map((w) => (
                  <th key={w} colSpan={3} style={{ ...thS, textAlign: "center", borderRight: "1px solid rgba(255,255,255,.08)", background: "rgba(201,162,39,.08)", color: "var(--gold)" }}>{w}</th>
                ))}
                <th colSpan={3} style={{ ...thS, textAlign: "center", background: "rgba(201,162,39,.14)", color: "var(--gold)", fontWeight: 800 }}>Total</th>
              </tr>
              {/* Row 2: sub-headers */}
              <tr style={{ background: "#0a1628", position: "sticky", top: "38px", zIndex: 2 }}>
                {detailWeeks.flatMap((w) => [
                  <th key={`${w}-b`} style={{ ...subThS, color: "#f59e0b" }}>Biaya</th>,
                  <th key={`${w}-p`} style={{ ...subThS, color: "#22c55e" }}>Penj.</th>,
                  <th key={`${w}-r`} style={{ ...subThS, color: "var(--gold)", borderRight: "1px solid rgba(255,255,255,.08)" }}>ROAS</th>,
                ])}
                <th style={{ ...subThS, color: "#f59e0b" }}>Biaya</th>
                <th style={{ ...subThS, color: "#22c55e" }}>Penj.</th>
                <th style={{ ...subThS, color: "var(--gold)" }}>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {detailPivot.length === 0 && (
                <tr><td colSpan={2 + detailWeeks.length * 3 + 3}
                  style={{ textAlign: "center", color: "var(--muted)", padding: 32 }}>
                  No product data found for this group.
                </td></tr>
              )}
              {detailPivot.map((p, i) => (
                <tr key={`${p.item_name}|${i}`}
                  style={{ background: i % 2 === 0 ? "rgba(255,255,255,.02)" : "transparent",
                    borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                  <td style={{ padding: "7px 10px", color: "var(--muted)", fontFamily: "monospace", fontSize: 11, borderRight: "1px solid rgba(255,255,255,.04)" }}>
                    {p.kode_produk || "—"}
                  </td>
                  <td style={{ padding: "7px 10px", color: "#c8d8f0", lineHeight: 1.35, borderRight: "1px solid rgba(255,255,255,.04)" }}>
                    {p.item_name}
                  </td>
                  {detailWeeks.flatMap((w) => {
                    const cell = p.weeks[w];
                    return [
                      <td key={`${w}-b`} style={numCellS}>
                        {cell?.biaya ? <span style={{ color: "#f59e0b" }}>{idrShort(cell.biaya)}</span> : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>,
                      <td key={`${w}-p`} style={numCellS}>
                        {cell?.penj ? <span style={{ color: "#22c55e" }}>{idrShort(cell.penj)}</span> : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>,
                      <td key={`${w}-r`} style={{ ...numCellS, borderRight: "1px solid rgba(255,255,255,.06)" }}>
                        {cell ? <span style={{ color: "var(--gold)", fontWeight: 700 }}>{roasStr(cell.penj, cell.biaya)}</span> : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>,
                    ];
                  })}
                  <td style={{ ...numCellS, fontWeight: 700 }}><span style={{ color: "#f59e0b" }}>{idrShort(p.total.biaya)}</span></td>
                  <td style={{ ...numCellS, fontWeight: 700 }}><span style={{ color: "#22c55e" }}>{idrShort(p.total.penj)}</span></td>
                  <td style={{ ...numCellS, fontWeight: 700 }}><span style={{ color: "var(--gold)" }}>{roasStr(p.total.penj, p.total.biaya)}</span></td>
                </tr>
              ))}
            </tbody>
            {detailPivot.length > 0 && (
              <tfoot>
                <tr style={{ background: "rgba(201,162,39,.10)", borderTop: "2px solid rgba(201,162,39,.4)" }}>
                  <td colSpan={2} style={{ padding: "8px 10px", fontWeight: 800, color: "#fff", fontSize: 12 }}>TOTAL</td>
                  {detailWeeks.flatMap((w) => {
                    const b = detailPivot.reduce((s, p) => s + (p.weeks[w]?.biaya || 0), 0);
                    const v = detailPivot.reduce((s, p) => s + (p.weeks[w]?.penj  || 0), 0);
                    return [
                      <td key={`${w}-b`} style={{ ...numCellS, fontWeight: 800 }}><span style={{ color: "#f59e0b" }}>{b ? idrShort(b) : "—"}</span></td>,
                      <td key={`${w}-p`} style={{ ...numCellS, fontWeight: 800 }}><span style={{ color: "#22c55e" }}>{v ? idrShort(v) : "—"}</span></td>,
                      <td key={`${w}-r`} style={{ ...numCellS, fontWeight: 800, borderRight: "1px solid rgba(255,255,255,.08)" }}>
                        <span style={{ color: "var(--gold)" }}>{roasStr(v, b)}</span>
                      </td>,
                    ];
                  })}
                  {(() => {
                    const tb = detailPivot.reduce((s, p) => s + p.total.biaya, 0);
                    const tp = detailPivot.reduce((s, p) => s + p.total.penj,  0);
                    return [
                      <td key="t-b" style={{ ...numCellS, fontWeight: 800 }}><span style={{ color: "#f59e0b" }}>{idr(tb)}</span></td>,
                      <td key="t-p" style={{ ...numCellS, fontWeight: 800 }}><span style={{ color: "#22c55e" }}>{idr(tp)}</span></td>,
                      <td key="t-r" style={{ ...numCellS, fontWeight: 800 }}><span style={{ color: "var(--gold)" }}>{roasStr(tp, tb)}</span></td>,
                    ];
                  })()}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 11, color: "var(--muted)", flexWrap: "wrap" }}>
        <span><span style={{ color: "#f59e0b", fontWeight: 700 }}>■</span> Biaya</span>
        <span><span style={{ color: "#22c55e", fontWeight: 700 }}>■</span> Penjualan Langsung</span>
        <span><span style={{ color: "var(--gold)", fontWeight: 700 }}>■</span> ROAS</span>
      </div>
    </div>,
    document.body
  );

  /* ════════════════════════════════════════════════════════════════════ */
  return (
    <>
      <style>{`
        .ads-cell{display:flex;flex-direction:column;gap:1px;line-height:1.25}
        .ads-cell .b{color:#f59e0b;font-weight:700}
        .ads-cell .p{color:#22c55e}
        .ads-cell .r{color:var(--gold);font-weight:700}
        .ads-modal-inp{width:84px;padding:3px 6px;border-radius:6px;border:1px solid rgba(201,162,39,.25);
          background:rgba(10,22,40,.6);color:var(--text);font-size:11px;margin-top:2px}
        .ads-modal-inp:focus{border-color:var(--gold);outline:none}
        .mode-tab{padding:7px 16px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer}
        .mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
        .grp-row{cursor:pointer;transition:background .15s}
        .grp-row:hover{background:rgba(201,162,39,.07)!important}
      `}</style>

      {detailModal}

      {/* ───── Upload Iklan ───── */}
      <div className="panel">
        <h3 style={{ margin: "0 0 4px" }}>Upload Iklan</h3>
        <div className="hint" style={{ marginBottom: 16 }}>
          Export <strong>one ad group per file</strong> from Shopee (e.g. "Grup Hero Panasonic"), pick the period &amp; dealer, then upload.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
          <Field label="City">
            <select value={up.city} onChange={(e) => pickCity(e.target.value)}>
              <option value="">Select city</option>
              {cities.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
            </select>
          </Field>
          <Field label="Dealer (Nama Toko)">
            <select value={up.dealer} onChange={(e) => setUp((u) => ({ ...u, dealer: e.target.value }))} disabled={!up.city}>
              <option value="">{up.city ? "Select dealer" : "Select city first"}</option>
              {dealers.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Grup Iklan">
            <input type="text" placeholder="e.g. Grup Hero" value={up.grup}
              onChange={(e) => setUp((u) => ({ ...u, grup: e.target.value }))} />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 16 }}>
          <Field label="Year">
            <select value={up.year} onChange={(e) => setUp((u) => ({ ...u, year: Number(e.target.value) }))}>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Bulan">
            <select value={up.month} onChange={(e) => setUp((u) => ({ ...u, month: e.target.value }))}>
              <option value="">Month</option>
              {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Week">
            <select value={up.week} onChange={(e) => setUp((u) => ({ ...u, week: e.target.value }))}>
              <option value="">Week</option>
              {WEEKS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <input type="file" accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: 12, color: "#bcd" }} />
          <button className="btn-gold" disabled={busy} onClick={submitUpload} style={{ padding: "10px 40px" }}>
            {busy ? "Uploading…" : "Upload Iklan"}
          </button>
          {file && <span style={{ fontSize: 12, color: "var(--gold)" }}>✓ {file.name}</span>}
        </div>

        {log.length > 0 && (
          <div style={{ background: "rgba(7,13,26,.8)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, fontFamily: "monospace", fontSize: 12, marginTop: 14 }}>
            {log.map((l, i) => <div key={i} style={{ color: l.startsWith("✓") ? "var(--gold)" : "#f87171" }}>{l}</div>)}
          </div>
        )}
      </div>

      {/* ───── Grup Iklan Performance ───── */}
      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>Grup Iklan Performance</h3>
            <div className="hint">
              Click any row to see the product-level breakdown &nbsp;↗
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className={`mode-tab ${mode === "week"  ? "on" : ""}`} onClick={() => { monthLockedRef.current = false; setMode("week"); }}>Week vs Week</button>
            <button className={`mode-tab ${mode === "month" ? "on" : ""}`} onClick={() => setMode("month")}>Month vs Month</button>
          </div>
        </div>

        {/* filter bar */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${mode === "week" ? 4 : 3},1fr) auto auto`, gap: 10, marginBottom: 16, alignItems: "end" }}>
          <Field label="Year">
            <select value={fltYear} onChange={(e) => setFltYear(e.target.value)}>
              <option value="">All Years</option>
              {filters.years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          {mode === "week" && (
            <Field label="Month">
              <select value={fltMonth} onChange={(e) => { monthLockedRef.current = true; setFltMonth(e.target.value); }}>
                <option value="">All Months</option>
                {MONTHS.filter((m) => filters.months.includes(m)).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          )}
          <Field label="Dealer">
            <select value={fltStore} onChange={(e) => setFltStore(e.target.value)}>
              <option value="">All Dealers</option>
              {filters.stores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Grup Iklan">
            <select value={fltGrup} onChange={(e) => setFltGrup(e.target.value)}>
              <option value="">All Groups</option>
              {filters.grups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <button className="btn-ghost" style={{ height: 38 }}
            onClick={() => { setFltStore(""); setFltGrup(""); }}>Reset</button>
          <span style={{ alignSelf: "end", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", paddingBottom: 8 }}>
            {loading ? "Loading…" : `${groups.length} groups`}
          </span>
        </div>

        {rpcError && (
          <div style={{ padding: 12, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 10, fontSize: 12, color: "#fca5a5", marginBottom: 14, fontFamily: "monospace" }}>
            ⚠ RPC error: {rpcError}
          </div>
        )}

        {mode === "week" && !fltMonth && !rpcError && (
          <div style={{ padding: 14, background: "rgba(201,162,39,.06)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 10, fontSize: 13, color: "var(--gold)", marginBottom: 14 }}>
            Pick a <strong>Month</strong> to compare its weeks side by side.
          </div>
        )}

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Dealer</th>
                <th>Grup Iklan</th>
                {periods.map((p) => <th key={p} className="num" style={{ minWidth: 120 }}>{p}</th>)}
                <th className="num" style={{ minWidth: 120 }}>Total</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={`${g.store}|${g.grup}`} className="grp-row"
                  onClick={() => openDetail(g.store, g.grup)}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{g.store}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{g.grup}</td>
                  {periods.map((p) => {
                    const c = g.cells[p];
                    const has = c && (c.biaya || c.penj);
                    return (
                      <td key={p} className="num">
                        {has ? (
                          <div className="ads-cell">
                            <span className="b" title="Biaya">{idrShort(c.biaya)}</span>
                            <span className="p" title="Penjualan Langsung">{idrShort(c.penj)}</span>
                            <span className="r" title="ROAS">{roasStr(c.penj, c.biaya)}</span>
                            {mode === "week" ? (
                              <input className="ads-modal-inp" defaultValue={c.modal ?? ""} placeholder="Modal/hari"
                                key={`${g.store}|${g.grup}|${p}|${c.modal ?? ""}`}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => { e.stopPropagation(); saveModal(g.store, g.grup, p, e.target.value); }} />
                            ) : (
                              c.modal != null && <span style={{ fontSize: 10, color: "var(--muted)" }}>Modal {idrShort(c.modal)}</span>
                            )}
                          </div>
                        ) : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>
                    );
                  })}
                  <td className="num">
                    <div className="ads-cell">
                      <span className="b">{idrShort(g.total.biaya)}</span>
                      <span className="p">{idrShort(g.total.penj)}</span>
                      <span className="r">{roasStr(g.total.penj, g.total.biaya)}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: "center", color: "var(--gold)", fontSize: 16 }}>↗</td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={periods.length + 4} style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>
                  {loading ? "Loading…" : rpcError ? "Error — see message above." : "No data yet. Upload via the form above with Grup Iklan and Dealer filled in."}
                </td></tr>
              )}
            </tbody>
            {groups.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: "2px solid rgba(201,162,39,.3)" }}>
                  <td colSpan={2} style={{ fontWeight: 800, color: "#fff" }}>TOTAL</td>
                  {periods.map((p) => {
                    const sub = aggregateRows(rows.filter((r) => (mode === "week" ? r.week : r.month) === p));
                    return (
                      <td key={p} className="num">
                        <div className="ads-cell">
                          <span className="b">{idrShort(sub.biaya)}</span>
                          <span className="p">{idrShort(sub.penj)}</span>
                          <span className="r">{roasStr(sub.penj, sub.biaya)}</span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="num">
                    <div className="ads-cell">
                      <span className="b">{idr(grandTotal.biaya)}</span>
                      <span className="p">{idr(grandTotal.penj)}</span>
                      <span className="r">{roasStr(grandTotal.penj, grandTotal.biaya)}</span>
                    </div>
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 11, color: "var(--muted)", flexWrap: "wrap" }}>
          <span><span style={{ color: "#f59e0b", fontWeight: 700 }}>■</span> Biaya</span>
          <span><span style={{ color: "#22c55e", fontWeight: 700 }}>■</span> Penjualan Langsung</span>
          <span><span style={{ color: "var(--gold)", fontWeight: 700 }}>■</span> ROAS (Penj. Langsung ÷ Biaya)</span>
          <span>Modal/hari editable in Week view &nbsp;·&nbsp; Click any row to drill down ↗</span>
        </div>
      </div>
    </>
  );
}

/* ── Shared styles ──────────────────────────────────────────────────────── */
const thS: React.CSSProperties = {
  padding: "10px 10px", fontWeight: 700, fontSize: 12, color: "#c8d8f0",
  borderBottom: "1px solid rgba(255,255,255,.1)", whiteSpace: "nowrap",
};
const subThS: React.CSSProperties = {
  padding: "5px 8px", fontWeight: 600, fontSize: 11,
  borderBottom: "1px solid rgba(255,255,255,.1)", textAlign: "right", whiteSpace: "nowrap",
};
const numCellS: React.CSSProperties = {
  padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fld" style={{ minWidth: 0 }}><label>{label}</label>{children}</div>;
}
