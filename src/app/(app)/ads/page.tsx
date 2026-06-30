"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/* ── Constants ──────────────────────────────────────────────────────────── */
const MONTHS    = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS     = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
const THIS_YEAR = new Date().getFullYear();
const YEARS     = Array.from({ length: 6 }, (_, i) => THIS_YEAR - 2 + i);

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

// Detail modal types
type DetailRow = {
  item_name: string; kode_produk: string | null;
  month: string | null; week: string | null;
  biaya: number; gmv: number; omzet: number; roas: number | null;
};
type PeriodCell = { biaya: number; gmv: number; roas: number | null };
type ProductPivot = {
  item_name: string; kode_produk: string | null;
  periods: Record<string, PeriodCell>;
  total: { biaya: number; gmv: number };
};

/* ── Helpers ────────────────────────────────────────────────────────────── */
const idr      = (n: number) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const idrShort = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1e9) return "Rp " + (v / 1e9).toFixed(1) + "M";
  if (Math.abs(v) >= 1e6) return "Rp " + (v / 1e6).toFixed(1) + "jt";
  if (Math.abs(v) >= 1e3) return "Rp " + (v / 1e3).toFixed(0) + "rb";
  return "Rp " + v;
};
const roasStr = (gmv: number, biaya: number) => biaya > 0 ? (gmv / biaya).toFixed(2) + "×" : "—";

function aggregateRows(list: AdsRow[]): Cell {
  return {
    biaya: list.reduce((s, r) => s + (r.biaya || 0), 0),
    penj:  list.reduce((s, r) => s + (r.penjualan_langsung || 0), 0),
    omzet: list.reduce((s, r) => s + (r.omzet || 0), 0),
    modal: (() => {
      const v = list.map((r) => r.modal_harian).filter((m): m is number => m != null);
      return v.length ? v.reduce((s, m) => s + m, 0) : null;
    })(),
  };
}

/* ════════════════════════════════════════════════════════════════════════ */
export default function AdsPage() {
  const [supabase]  = useState(() => createClient());
  const [clientId,  setClientId]  = useState("");
  const [userId,    setUserId]    = useState("");
  const [mounted,   setMounted]   = useState(false);

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
  const monthLockedRef = useRef(false);

  // upload form
  const [cities,  setCities]  = useState<{ value: string; pic: string | null }[]>([]);
  const [dealers, setDealers] = useState<string[]>([]);
  const [up, setUp] = useState({ city: "", dealer: "", year: THIS_YEAR, month: "", week: "", grup: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [log,  setLog]  = useState<string[]>([]);

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
    if (!file)           { setLog(["Pick an Ads file first."]); return; }
    if (!up.dealer)      { setLog(["Select a Dealer."]); return; }
    if (!up.grup.trim()) { setLog(["Enter the Grup Iklan name."]); return; }
    if (!up.month)       { setLog(["Select a Bulan."]); return; }
    if (!up.week)        { setLog(["Select a Week."]); return; }
    setBusy(true); setLog([]);
    const pic = cities.find((c) => c.value === up.city)?.pic || "";
    const fd  = new FormData();
    fd.append("file", file);
    fd.append("source", "ads");
    fd.append("manual", JSON.stringify({
      admin: "", city: up.city, pic_client: pic, store_name: up.dealer,
      year: up.year, bulan: up.month, week: up.week, grup_iklan: up.grup.trim(),
    }));
    fd.append("client_id", clientId);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j   = await res.json();
      setLog([res.ok ? `✓ ${up.grup.trim()} · ${up.dealer} · ${up.month} ${up.week}: ${j.rows} rows` : `✗ ${j.error}`]);
      if (res.ok) { setFile(null); monthLockedRef.current = false; setFltMonth(""); setFltYear(""); }
    } catch (e) {
      setLog([`✗ ${String(e)}`]);
    }
    setBusy(false);
  }

  /* ── open detail modal ── */
  async function openDetail(store: string, grup: string) {
    setDetailStore(store); setDetailGrup(grup);
    setDetailRows([]); setDetailError(""); setDetailLoading(true); setShowDetail(true);
    try {
      const params: Record<string, unknown> = { p_store: store, p_grup: grup };
      if (fltYear)                     params.p_year  = Number(fltYear);
      if (mode === "week" && fltMonth) params.p_month = fltMonth;
      const { data, error } = await supabase.rpc("ads_detail", params);
      if (error) setDetailError(error.message);
      else       setDetailRows((data as DetailRow[]) || []);
    } catch (e) { setDetailError(String(e)); }
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

  /* ── pivot summary table ── */
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
      for (const p of periods)
        cells[p] = aggregateRows(list.filter((r) => (mode === "week" ? r.week : r.month) === p));
      return { store, grup, cells, total: aggregateRows(list) };
    }).sort((a, b) => b.total.biaya - a.total.biaya);
    return { groups, periods };
  }, [rows, mode]);

  /* ── pivot detail modal (week or month) ── */
  const { detailPivot, detailPeriods } = useMemo(() => {
    const periodKey = (r: DetailRow) => mode === "week" ? (r.week ?? "") : (r.month ?? "");
    const periodSet = new Set<string>();
    for (const r of detailRows) { const k = periodKey(r); if (k) periodSet.add(k); }
    const detailPeriods = mode === "week"
      ? WEEKS.filter((w) => periodSet.has(w))
      : MONTHS.filter((m) => periodSet.has(m));

    const map = new Map<string, ProductPivot>();
    for (const r of detailRows) {
      const key = `${r.item_name}|||${r.kode_produk ?? ""}`;
      if (!map.has(key)) map.set(key, { item_name: r.item_name, kode_produk: r.kode_produk, periods: {}, total: { biaya: 0, gmv: 0 } });
      const p  = map.get(key)!;
      const pk = periodKey(r);
      if (pk) {
        if (!p.periods[pk]) p.periods[pk] = { biaya: 0, gmv: 0, roas: null };
        p.periods[pk].biaya += r.biaya;
        p.periods[pk].gmv   += r.gmv;
      }
      p.total.biaya += r.biaya;
      p.total.gmv   += r.gmv;
    }
    // Recalculate ROAS after full aggregation
    for (const p of map.values()) {
      for (const cell of Object.values(p.periods))
        cell.roas = cell.biaya > 0 ? cell.gmv / cell.biaya : null;
    }
    return {
      detailPivot:   [...map.values()].sort((a, b) => b.total.biaya - a.total.biaya),
      detailPeriods,
    };
  }, [detailRows, mode]);

  const grandTotal = useMemo(() => aggregateRows(rows), [rows]);

  /* ── Detail Modal ─────────────────────────────────────────────────── */
  const detailModal = showDetail && mounted && createPortal(
    <div style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(2,6,16,.92)", backdropFilter:"blur(10px)", display:"flex", flexDirection:"column", padding:20 }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:"#fff" }}>{detailStore}</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,.6)", marginTop:3 }}>
            Grup Iklan: <strong style={{ color:"#fff" }}>{detailGrup}</strong>
            {fltMonth && mode === "week" && <span style={{ marginLeft:12 }}>{fltMonth} {fltYear}</span>}
            {mode === "month" && fltYear && <span style={{ marginLeft:12 }}>{fltYear}</span>}
          </div>
        </div>
        <button onClick={() => setShowDetail(false)}
          style={{ padding:"8px 20px", borderRadius:10, border:"1px solid rgba(255,255,255,.2)", background:"rgba(255,255,255,.06)", color:"#fff", fontWeight:700, cursor:"pointer", fontSize:13 }}>
          ✕ Close
        </button>
      </div>

      <div style={{ height:1, background:"linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent)", marginBottom:14 }} />

      {detailError && (
        <div style={{ padding:12, background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.25)", borderRadius:10, color:"#fca5a5", fontSize:13, marginBottom:14, fontFamily:"monospace" }}>
          ⚠ {detailError}
        </div>
      )}

      {detailLoading ? (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", flex:1, color:"rgba(255,255,255,.5)", fontSize:14 }}>
          Loading product data…
        </div>
      ) : (
        <div style={{ overflow:"auto", flex:1, borderRadius:12, border:"1px solid rgba(255,255,255,.08)" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:"#0a1628", position:"sticky", top:0, zIndex:2 }}>
                <th rowSpan={2} style={{ ...thS, minWidth:110, textAlign:"left" }}>Kode Produk</th>
                <th rowSpan={2} style={{ ...thS, minWidth:220, textAlign:"left", borderRight:"1px solid rgba(255,255,255,.08)" }}>Nama Iklan / Produk</th>
                {/* Analisa placeholder column */}
                <th rowSpan={2} style={{ ...thS, minWidth:70, textAlign:"center", background:"rgba(201,162,39,.06)", borderRight:"1px solid rgba(255,255,255,.08)" }}>
                  <span style={{ color:"rgba(201,162,39,.7)", fontSize:10 }}>ANALISA</span>
                </th>
                {detailPeriods.map((p) => (
                  <th key={p} colSpan={3} style={{ ...thS, textAlign:"center", borderRight:"1px solid rgba(255,255,255,.08)" }}>{p}</th>
                ))}
                <th colSpan={3} style={{ ...thS, textAlign:"center", background:"rgba(255,255,255,.06)", fontWeight:800 }}>Total</th>
              </tr>
              <tr style={{ background:"#070d1a", position:"sticky", top:"38px", zIndex:2 }}>
                {detailPeriods.flatMap((p) => [
                  <th key={`${p}-b`} style={subThS}>Biaya</th>,
                  <th key={`${p}-g`} style={subThS}>GMV</th>,
                  <th key={`${p}-r`} style={{ ...subThS, borderRight:"1px solid rgba(255,255,255,.08)" }}>ROAS</th>,
                ])}
                <th style={subThS}>Biaya</th>
                <th style={subThS}>GMV</th>
                <th style={subThS}>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {detailPivot.length === 0 && (
                <tr><td colSpan={3 + detailPeriods.length * 3 + 3}
                  style={{ textAlign:"center", color:"rgba(255,255,255,.4)", padding:32 }}>
                  No product data found for this group.
                </td></tr>
              )}
              {detailPivot.map((p, i) => (
                <tr key={`${p.item_name}|${i}`}
                  style={{ background:i%2===0?"rgba(255,255,255,.02)":"transparent", borderBottom:"1px solid rgba(255,255,255,.04)" }}>
                  <td style={{ padding:"7px 10px", color:"rgba(255,255,255,.5)", fontFamily:"monospace", fontSize:11 }}>
                    {p.kode_produk || "—"}
                  </td>
                  <td style={{ padding:"7px 10px", color:"#fff", lineHeight:1.35, borderRight:"1px solid rgba(255,255,255,.04)" }}>
                    {p.item_name}
                  </td>
                  {/* Analisa placeholder */}
                  <td style={{ padding:"7px 8px", textAlign:"center", color:"rgba(255,255,255,.3)", fontSize:11, borderRight:"1px solid rgba(255,255,255,.04)" }}>—</td>
                  {detailPeriods.flatMap((w) => {
                    const c = p.periods[w];
                    return [
                      <td key={`${w}-b`} style={numCellS}>{c?.biaya ? idrShort(c.biaya) : <span style={{ color:"rgba(255,255,255,.3)" }}>—</span>}</td>,
                      <td key={`${w}-g`} style={numCellS}>{c?.gmv  ? idrShort(c.gmv)  : <span style={{ color:"rgba(255,255,255,.3)" }}>—</span>}</td>,
                      <td key={`${w}-r`} style={{ ...numCellS, borderRight:"1px solid rgba(255,255,255,.06)" }}>
                        {c ? <span style={{ fontWeight:700 }}>{roasStr(c.gmv, c.biaya)}</span> : <span style={{ color:"rgba(255,255,255,.3)" }}>—</span>}
                      </td>,
                    ];
                  })}
                  <td style={{ ...numCellS, fontWeight:700 }}>{idrShort(p.total.biaya)}</td>
                  <td style={{ ...numCellS, fontWeight:700 }}>{idrShort(p.total.gmv)}</td>
                  <td style={{ ...numCellS, fontWeight:700 }}>{roasStr(p.total.gmv, p.total.biaya)}</td>
                </tr>
              ))}
            </tbody>
            {detailPivot.length > 0 && (
              <tfoot>
                <tr style={{ background:"rgba(255,255,255,.06)", borderTop:"2px solid rgba(255,255,255,.12)" }}>
                  <td colSpan={3} style={{ padding:"8px 10px", fontWeight:800, color:"#fff", fontSize:12 }}>TOTAL</td>
                  {detailPeriods.flatMap((w) => {
                    const b = detailPivot.reduce((s, p) => s + (p.periods[w]?.biaya || 0), 0);
                    const g = detailPivot.reduce((s, p) => s + (p.periods[w]?.gmv   || 0), 0);
                    return [
                      <td key={`${w}-b`} style={{ ...numCellS, fontWeight:800 }}>{b ? idrShort(b) : "—"}</td>,
                      <td key={`${w}-g`} style={{ ...numCellS, fontWeight:800 }}>{g ? idrShort(g) : "—"}</td>,
                      <td key={`${w}-r`} style={{ ...numCellS, fontWeight:800, borderRight:"1px solid rgba(255,255,255,.08)" }}>{roasStr(g, b)}</td>,
                    ];
                  })}
                  {(() => {
                    const tb = detailPivot.reduce((s, p) => s + p.total.biaya, 0);
                    const tg = detailPivot.reduce((s, p) => s + p.total.gmv,   0);
                    return [
                      <td key="t-b" style={{ ...numCellS, fontWeight:800 }}>{idr(tb)}</td>,
                      <td key="t-g" style={{ ...numCellS, fontWeight:800 }}>{idr(tg)}</td>,
                      <td key="t-r" style={{ ...numCellS, fontWeight:800 }}>{roasStr(tg, tb)}</td>,
                    ];
                  })()}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <div style={{ display:"flex", gap:18, marginTop:10, fontSize:11, color:"rgba(255,255,255,.4)", flexWrap:"wrap" }}>
        <span>■ Biaya</span>
        <span>■ GMV (Penjualan Langsung)</span>
        <span>■ ROAS = GMV ÷ Biaya</span>
        <span style={{ color:"rgba(201,162,39,.5)" }}>■ Analisa — formula TBD</span>
      </div>
    </div>,
    document.body
  );

  /* ════════════════════════════════════════════════════════════════════ */
  return (
    <>
      <style>{`
        .ads-cell{display:flex;flex-direction:column;gap:1px;line-height:1.25}
        .ads-cell .b,.ads-cell .p,.ads-cell .r{color:#e8edf8;font-weight:600}
        .ads-modal-inp{width:84px;padding:3px 6px;border-radius:6px;border:1px solid rgba(201,162,39,.25);
          background:rgba(10,22,40,.6);color:var(--text);font-size:11px;margin-top:2px}
        .ads-modal-inp:focus{border-color:var(--gold);outline:none}
        .mode-tab{padding:7px 16px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
        .mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
        .grp-row{cursor:pointer;transition:background .15s}
        .grp-row:hover{background:rgba(201,162,39,.07)!important}
      `}</style>

      {detailModal}

      {/* ── Sub-page tabs ── */}
      <div style={{ display:"flex", gap:8, marginBottom:18 }}>
        <span className="mode-tab on">Performance</span>
        <Link href="/ads/formulation" className="mode-tab">Formulation</Link>
      </div>

      {/* ── Upload Iklan ── */}
      <div className="panel">
        <h3 style={{ margin:"0 0 4px" }}>Upload Iklan</h3>
        <div className="hint" style={{ marginBottom:16 }}>
          Export <strong>one ad group per file</strong> from Shopee, pick the period &amp; dealer, then upload.
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:14 }}>
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

        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:16 }}>
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

        <div style={{ display:"flex", gap:14, alignItems:"center", flexWrap:"wrap" }}>
          <input type="file" accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ fontSize:12, color:"#bcd" }} />
          <button className="btn-gold" disabled={busy} onClick={submitUpload} style={{ padding:"10px 40px" }}>
            {busy ? "Uploading…" : "Upload Iklan"}
          </button>
          {file && <span style={{ fontSize:12, color:"var(--gold)" }}>✓ {file.name}</span>}
        </div>

        {log.length > 0 && (
          <div style={{ background:"rgba(7,13,26,.8)", border:"1px solid var(--line)", borderRadius:12, padding:14, fontFamily:"monospace", fontSize:12, marginTop:14 }}>
            {log.map((l, i) => <div key={i} style={{ color:l.startsWith("✓")?"var(--gold)":"#f87171" }}>{l}</div>)}
          </div>
        )}
      </div>

      {/* ── Grup Iklan Performance ── */}
      <div className="panel" style={{ marginTop:18 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12, marginBottom:8 }}>
          <div>
            <h3 style={{ margin:0 }}>Grup Iklan Performance</h3>
            <div className="hint">Click any row to see the product-level breakdown ↗</div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button className={`mode-tab ${mode==="week"?"on":""}`}
              onClick={() => { monthLockedRef.current=false; setMode("week"); }}>Week vs Week</button>
            <button className={`mode-tab ${mode==="month"?"on":""}`}
              onClick={() => setMode("month")}>Month vs Month</button>
          </div>
        </div>

        {/* filter bar */}
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${mode==="week"?4:3},1fr) auto auto`, gap:10, marginBottom:16, alignItems:"end" }}>
          <Field label="Year">
            <select value={fltYear} onChange={(e) => setFltYear(e.target.value)}>
              <option value="">All Years</option>
              {filters.years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          {mode === "week" && (
            <Field label="Month">
              <select value={fltMonth} onChange={(e) => { monthLockedRef.current=true; setFltMonth(e.target.value); }}>
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
          <button className="btn-ghost" style={{ height:38 }}
            onClick={() => { setFltStore(""); setFltGrup(""); }}>Reset</button>
          <span style={{ alignSelf:"end", fontSize:12, color:"var(--muted)", whiteSpace:"nowrap", paddingBottom:8 }}>
            {loading ? "Loading…" : `${groups.length} groups`}
          </span>
        </div>

        {rpcError && (
          <div style={{ padding:12, background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.25)", borderRadius:10, fontSize:12, color:"#fca5a5", marginBottom:14, fontFamily:"monospace" }}>
            ⚠ RPC error: {rpcError}
          </div>
        )}

        {mode === "week" && !fltMonth && !rpcError && (
          <div style={{ padding:14, background:"rgba(201,162,39,.06)", border:"1px solid rgba(201,162,39,.2)", borderRadius:10, fontSize:13, color:"var(--gold)", marginBottom:14 }}>
            Pick a <strong>Month</strong> to compare its weeks side by side.
          </div>
        )}

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Dealer</th>
                <th>Grup Iklan</th>
                {periods.map((p) => <th key={p} className="num" style={{ minWidth:120 }}>{p}</th>)}
                <th className="num" style={{ minWidth:120 }}>Total</th>
                <th style={{ width:40 }}></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={`${g.store}|${g.grup}`} className="grp-row" onClick={() => openDetail(g.store, g.grup)}>
                  <td style={{ fontWeight:600, whiteSpace:"nowrap" }}>{g.store}</td>
                  <td style={{ whiteSpace:"nowrap" }}>{g.grup}</td>
                  {periods.map((p) => {
                    const c   = g.cells[p];
                    const has = c && (c.biaya || c.penj);
                    return (
                      <td key={p} className="num">
                        {has ? (
                          <div className="ads-cell">
                            <span className="b">{idrShort(c.biaya)}</span>
                            <span className="p">{idrShort(c.penj)}</span>
                            <span className="r">{roasStr(c.penj, c.biaya)}</span>
                            {mode === "week" && (
                              <input className="ads-modal-inp" defaultValue={c.modal ?? ""} placeholder="Modal/hari"
                                key={`${g.store}|${g.grup}|${p}|${c.modal ?? ""}`}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => { e.stopPropagation(); saveModal(g.store, g.grup, p, e.target.value); }} />
                            )}
                          </div>
                        ) : <span style={{ color:"var(--muted)" }}>—</span>}
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
                  <td style={{ textAlign:"center", color:"var(--gold)", fontSize:16 }}>↗</td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={periods.length+4} style={{ textAlign:"center", color:"var(--muted)", padding:22 }}>
                  {loading ? "Loading…" : rpcError ? "Error — see message above." : "No data yet. Upload via the form above."}
                </td></tr>
              )}
            </tbody>
            {groups.length > 0 && (
              <tfoot>
                <tr style={{ borderTop:"2px solid rgba(201,162,39,.3)" }}>
                  <td colSpan={2} style={{ fontWeight:800, color:"#fff" }}>TOTAL</td>
                  {periods.map((p) => {
                    const sub = aggregateRows(rows.filter((r) => (mode==="week"?r.week:r.month)===p));
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

        <div style={{ display:"flex", gap:18, marginTop:12, fontSize:11, color:"var(--muted)", flexWrap:"wrap" }}>
          <span>■ Biaya</span>
          <span>■ GMV (Penjualan Langsung)</span>
          <span>■ ROAS = GMV ÷ Biaya</span>
          <span>Modal/hari editable in Week view · Click row to drill down ↗</span>
        </div>
      </div>
    </>
  );
}

/* ── Shared table header styles ─────────────────────────────────────────── */
const thS: React.CSSProperties = {
  padding:"10px 10px", fontWeight:700, fontSize:12, color:"#fff",
  borderBottom:"1px solid rgba(255,255,255,.1)", whiteSpace:"nowrap",
};
const subThS: React.CSSProperties = {
  padding:"5px 8px", fontWeight:600, fontSize:11, color:"rgba(255,255,255,.7)",
  borderBottom:"1px solid rgba(255,255,255,.1)", textAlign:"right", whiteSpace:"nowrap",
};
const numCellS: React.CSSProperties = {
  padding:"6px 8px", textAlign:"right", whiteSpace:"nowrap", color:"#e8edf8",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fld" style={{ minWidth:0 }}><label>{label}</label>{children}</div>;
}
