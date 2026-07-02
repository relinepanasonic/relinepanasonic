"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => THIS_YEAR - 1 + i);

type Category = "incubation" | "hero" | "regular" | "low_conversion";
type CatData  = { ads_spent: string; roas: string };
type FormData = Record<Category, CatData>;

const CAT_LABELS: Record<Category, string> = {
  incubation:     "Incubation",
  hero:           "Hero",
  regular:        "Regular",
  low_conversion: "Low Conversion",
};

const CAT_HINTS: Record<Category, string> = {
  incubation:     "New / growing ads — still building ROAS",
  hero:           "Top-performing ads with strong consistent ROAS",
  regular:        "Standard performing ads — stable spend and ROAS",
  low_conversion: "High spend, low conversion — review or cut",
};

const EMPTY_CAT: CatData = { ads_spent: "", roas: "" };
const EMPTY_FORM: FormData = {
  incubation:     { ...EMPTY_CAT },
  hero:           { ...EMPTY_CAT },
  regular:        { ...EMPTY_CAT },
  low_conversion: { ...EMPTY_CAT },
};

const idrFmt = (v: number) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(v));

export default function FormulationPage() {
  const [supabase] = useState(() => createClient());
  const [year,   setYear]   = useState(String(THIS_YEAR));
  const [month,  setMonth]  = useState("");
  const [baseRoas, setBaseRoas]   = useState<number | null>(null);
  const [baseLoading, setBaseLoading] = useState(false);
  const [baseError, setBaseError] = useState("");
  const [form,   setForm]   = useState<FormData>(EMPTY_FORM);

  // Baseline ROAS — live from the same dashboard_summary RPC the main
  // Dashboard uses, scoped to the Year/Month picked here. Not editable:
  // it's the existing reality the 5-stage thresholds get measured against.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBaseLoading(true); setBaseError("");
      const { data, error } = await supabase.rpc("dashboard_summary", {
        p_year: year ? Number(year) : null,
        p_quarter: null,
        p_month: month || null,
        p_week: null,
        p_city: null,
        p_store: null,
      });
      if (cancelled) return;
      if (error) setBaseError(error.message);
      else setBaseRoas((data as { kpis?: { roas?: number | null } })?.kpis?.roas ?? null);
      setBaseLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, year, month]);

  function setField(cat: Category, field: keyof CatData, val: string) {
    setForm((f) => ({ ...f, [cat]: { ...f[cat], [field]: val } }));
  }

  const toNum = (s: string) => {
    const n = parseFloat(s.replace(/[^0-9.]/g, ""));
    return isNaN(n) ? 0 : n;
  };

  const totalSpent = (Object.keys(form) as Category[])
    .reduce((s, c) => s + toNum(form[c].ads_spent), 0);

  return (
    <>
      <style>{`
        .form-inp{
          width:100%;padding:8px 12px;border-radius:10px;
          border:1px solid rgba(201,162,39,.22);background:rgba(10,22,40,.6);
          color:#e8edf8;font-size:13px;outline:none;
        }
        .form-inp:focus{border-color:var(--gold)}
        .cat-card{border-radius:14px;border:1px solid var(--line);background:rgba(10,22,40,.4);padding:18px 20px}
        .f-mode-tab{padding:7px 18px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
        .f-mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
      `}</style>

      {/* ── Sub-page tabs ── */}
      <div style={{ display:"flex", gap:8, marginBottom:18 }}>
        <Link href="/ads" className="f-mode-tab">Performance</Link>
        <span className="f-mode-tab on">Formulation</span>
      </div>

      {/* ── Period selector ── */}
      <div className="panel" style={{ marginBottom:18 }}>
        <h3 style={{ margin:"0 0 14px" }}>Formulation Setup</h3>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:14, alignItems:"end" }}>
          <div className="fld"><label>Year</label>
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="fld"><label>Month</label>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">All Months</option>
              {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {/* Monthly AVG ROAS — live baseline from the Dashboard, same RPC & scope */}
          <div className="fld">
            <label>Monthly AVG ROAS (baseline)</label>
            <div style={{
              padding:"8px 12px", borderRadius:10, border:"1px solid rgba(201,162,39,.22)",
              background:"rgba(10,22,40,.6)", minHeight:34, display:"flex", alignItems:"center",
            }}>
              {baseLoading ? (
                <span style={{ color:"var(--muted)", fontSize:13 }}>Loading…</span>
              ) : baseError ? (
                <span style={{ color:"#f87171", fontSize:12 }}>⚠ {baseError}</span>
              ) : baseRoas != null ? (
                <span style={{ color:"var(--gold)", fontWeight:700, fontSize:16 }}>{baseRoas.toFixed(2)}×</span>
              ) : (
                <span style={{ color:"var(--muted)", fontSize:13 }}>No ads data for this period</span>
              )}
            </div>
          </div>
          <div style={{ paddingBottom:4, fontSize:12, color:"var(--muted)", lineHeight:1.5 }}>
            From the Dashboard's Panasonic Sales ÷ Ads Cost, for {month || "all months"} {year}.
            <div style={{ marginTop:2 }}>This is the baseline every stage below is measured against.</div>
          </div>
        </div>
      </div>

      {/* ── Category cards ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:16 }}>
        {(Object.keys(CAT_LABELS) as Category[]).map((cat) => {
          const spent = toNum(form[cat].ads_spent);
          const roas  = toNum(form[cat].roas);
          const gmv   = spent * roas;
          return (
            <div key={cat} className="cat-card">
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:CAT_COLOR[cat] }} />
                <div>
                  <div style={{ fontWeight:800, fontSize:15, color:"#e8edf8" }}>{CAT_LABELS[cat]}</div>
                  <div style={{ fontSize:11, color:"var(--muted)", marginTop:1 }}>{CAT_HINTS[cat]}</div>
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div className="fld">
                  <label>Ads Spent (Rp)</label>
                  <input className="form-inp" type="text" placeholder="e.g. 5000000"
                    value={form[cat].ads_spent}
                    onChange={(e) => setField(cat, "ads_spent", e.target.value)} />
                </div>
                <div className="fld">
                  <label>ROAS</label>
                  <input className="form-inp" type="text" placeholder="e.g. 3.5"
                    value={form[cat].roas}
                    onChange={(e) => setField(cat, "roas", e.target.value)} />
                </div>
              </div>

              {(spent > 0 || roas > 0) && (
                <div style={{ marginTop:12, display:"flex", gap:16, padding:"10px 14px", borderRadius:10, background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.06)" }}>
                  <Stat label="Ads Spent" value={spent > 0 ? idrFmt(spent) : "—"} />
                  <Stat label="ROAS"      value={roas  > 0 ? roas.toFixed(2) + "×" : "—"} />
                  <Stat label="Est. GMV"  value={gmv   > 0 ? idrFmt(gmv) : "—"} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Summary ── */}
      {totalSpent > 0 && (
        <div className="panel" style={{ marginTop:18 }}>
          <h3 style={{ margin:"0 0 14px" }}>Summary — {month || "All Months"} {year}</h3>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
            {(Object.keys(CAT_LABELS) as Category[]).map((cat) => {
              const s = toNum(form[cat].ads_spent);
              const r = toNum(form[cat].roas);
              const pct = totalSpent > 0 ? (s / totalSpent * 100) : 0;
              return (
                <div key={cat} style={{ textAlign:"center", padding:"14px 10px", borderRadius:12, background:"rgba(10,22,40,.5)", border:`1px solid ${CAT_COLOR[cat]}33` }}>
                  <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>{CAT_LABELS[cat]}</div>
                  <div style={{ fontSize:17, fontWeight:800, color:"#e8edf8" }}>
                    {s > 0 ? idrFmt(s) : "—"}
                  </div>
                  <div style={{ fontSize:12, color:CAT_COLOR[cat], marginTop:4 }}>
                    {r > 0 ? r.toFixed(2) + "× ROAS" : "—"}
                  </div>
                  <div style={{ fontSize:11, color:"var(--muted)", marginTop:4 }}>
                    {pct > 0 ? pct.toFixed(1) + "% of spend" : ""}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:14, padding:"12px 16px", borderRadius:12, background:"rgba(201,162,39,.06)", border:"1px solid rgba(201,162,39,.2)", display:"flex", gap:28, flexWrap:"wrap" }}>
            <Stat label="Total Ads Spent" value={idrFmt(totalSpent)} big />
            {baseRoas != null && (
              <Stat label="Baseline ROAS" value={baseRoas.toFixed(2) + "×"} big />
            )}
            {baseRoas != null && totalSpent > 0 && (
              <Stat label="Est. Total GMV (at baseline)" value={idrFmt(totalSpent * baseRoas)} big />
            )}
          </div>
          <div style={{ marginTop:10, fontSize:11, color:"var(--muted)" }}>
            ⚠ Data is not saved yet — persistence and formula integration coming in a future update.
          </div>
        </div>
      )}
    </>
  );
}

const CAT_COLOR: Record<Category, string> = {
  incubation:     "#60a5fa",
  hero:           "#facc15",
  regular:        "#4ade80",
  low_conversion: "#f87171",
};

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:big?17:14, fontWeight:700, color:"#e8edf8" }}>{value}</div>
    </div>
  );
}
