"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DataSource } from "@/lib/parse";

export const dynamic = "force-dynamic";

const SLOTS: { source: DataSource; label: string; hint: string; accept: string }[] = [
  { source: "perf", label: "Performa", hint: "sales_overview",       accept: ".xlsx,.xls,.csv" },
  { source: "spos", label: "SPOS",     hint: "parentskudetail",      accept: ".xlsx,.xls,.csv" },
  { source: "ads",  label: "Ads",      hint: "Data Keseluruhan Iklan", accept: ".xlsx,.xls,.csv" },
];

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS  = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
const THIS_YEAR = new Date().getFullYear();
const YEARS  = Array.from({ length: 6 }, (_, i) => THIS_YEAR - 2 + i); // 4 past + current + 1 future

const SRC_LABEL: Record<string, string> = { perf: "Performa", spos: "SPOS", ads: "Ads" };
const SRC_COLOR: Record<string, string> = { perf: "#22c55e", spos: "#3b82f6", ads: "#f59e0b" };

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toISO(d);
}
function todayISO(): string { return toISO(new Date()); }

type CityRow = { value: string; pic: string | null };
type UploadRow = {
  id: string; source: DataSource; filename: string | null; row_count: number; created_at: string;
  meta: { admin?: string; city?: string; pic_client?: string; store_name?: string; bulan?: string; week?: string; year?: number } | null;
};

export default function UploadPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");

  // form state
  const [form, setForm] = useState({
    admin: "", city: "", pic_panasonic: "", dealer: "",
    year: THIS_YEAR, bulan: "", week: "",
    tanggal_mulai: "", tanggal_berakhir: "",
  });
  const tanggal_input = todayISO();

  // dropdown data
  const [admins,  setAdmins]  = useState<string[]>([]);
  const [cities,  setCities]  = useState<CityRow[]>([]);
  const [dealers, setDealers] = useState<string[]>([]);
  const [files,   setFiles]   = useState<Record<string, File | null>>({});
  const [busy,    setBusy]    = useState(false);
  const [log,     setLog]     = useState<string[]>([]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [flt,     setFlt]     = useState({ year: "", month: "", week: "", city: "", dealer: "", source: "" });

  // load uploads
  const loadUploads = useCallback(async (cid: string) => {
    if (!cid) return;
    const { data } = await supabase.from("uploads")
      .select("id,source,filename,row_count,created_at,meta")
      .eq("client_id", cid)
      .order("created_at", { ascending: false });
    setUploads((data as UploadRow[]) || []);
  }, [supabase]);

  // initial load
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // get client id
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);

      // get admin list from profiles
      const { data: profiles } = await supabase.from("profiles")
        .select("display_name,email").eq("client_id", cid);
      const names = (profiles as { display_name: string | null; email: string | null }[] || [])
        .map((p) => p.display_name || p.email?.split("@")[0] || "")
        .filter(Boolean);
      // also add superadmin (client_id = null)
      const { data: sa } = await supabase.from("profiles")
        .select("display_name,email").is("client_id", null);
      const saNames = (sa as { display_name: string | null; email: string | null }[] || [])
        .map((p) => p.display_name || p.email?.split("@")[0] || "")
        .filter(Boolean);
      const allAdmins = Array.from(new Set([...names, ...saNames])).sort();
      setAdmins(allAdmins);

      // auto-select current user as default admin
      const { data: me } = await supabase.from("profiles").select("display_name,email").eq("id", user.id).single();
      const myName = (me as { display_name: string | null; email: string | null } | null)?.display_name
        || user.email?.split("@")[0] || "";
      setForm((f) => ({ ...f, admin: myName }));

      // get cities
      const { data: cityRows } = await supabase.from("master_data")
        .select("value,pic").eq("kind", "city").eq("client_id", cid).order("value");
      setCities((cityRows as CityRow[]) || []);

      loadUploads(cid);
    })();
  }, [supabase, loadUploads]);

  // when city changes: auto-fill PIC + reload dealers
  async function pickCity(city: string) {
    const pic = cities.find((c) => c.value === city)?.pic || "";
    setForm((f) => ({ ...f, city, pic_panasonic: pic, dealer: "" }));
    if (!city || !clientId) { setDealers([]); return; }
    const { data } = await supabase.from("master_data")
      .select("value").eq("kind", "dealer").eq("client_id", clientId).eq("city", city).order("value");
    setDealers(((data as { value: string }[]) || []).map((d) => d.value));
  }

  // tanggal mulai → auto berakhir +6D
  function pickStart(v: string) {
    if (!v) { setForm((f) => ({ ...f, tanggal_mulai: "", tanggal_berakhir: "" })); return; }
    setForm((f) => ({ ...f, tanggal_mulai: v, tanggal_berakhir: addDays(v, 6) }));
  }

  async function submit() {
    setBusy(true); setLog([]);
    if (!clientId) { setLog(["Workspace not ready."]); setBusy(false); return; }
    const chosen = SLOTS.filter((s) => files[s.source]);
    if (!chosen.length) { setLog(["Pick at least one file."]); setBusy(false); return; }
    const manual = {
      admin:        form.admin,
      city:         form.city,
      pic_client:   form.pic_panasonic,
      store_name:   form.dealer,
      year:         form.year,
      bulan:        form.bulan,
      week:         form.week,
      tanggal:      form.tanggal_mulai,
      tanggal_berakhir: form.tanggal_berakhir,
      tanggal_input,
    };
    for (const slot of chosen) {
      const fd = new FormData();
      fd.append("file", files[slot.source]!);
      fd.append("source", slot.source);
      fd.append("manual", JSON.stringify(manual));
      fd.append("client_id", clientId);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const j = await res.json();
        setLog((l) => [...l, res.ok ? `✓ ${slot.label}: ${j.rows} rows` : `✗ ${slot.label}: ${j.error}`]);
      } catch (e) {
        setLog((l) => [...l, `✗ ${slot.label}: ${String(e)}`]);
      }
    }
    setBusy(false);
    loadUploads(clientId);
  }

  async function delUpload(id: string) {
    if (!confirm("Delete this upload and all its rows? This cannot be undone.")) return;
    const { error } = await supabase.from("uploads").delete().eq("id", id);
    if (error) { alert(error.message); return; }
    loadUploads(clientId);
  }

  // ---------- upload log filter options ----------
  const uniq = (f: (u: UploadRow) => string | number | undefined | null) =>
    Array.from(new Set(uploads.map(f).filter((v) => v != null && v !== "") as string[])).sort();
  const fYears   = Array.from(new Set(uploads.map((u) => u.meta?.year).filter(Boolean) as number[])).sort((a,b) => b-a).map(String);
  const fMonths  = uniq((u) => u.meta?.bulan);
  const fWeeks   = uniq((u) => u.meta?.week);
  const fCities  = uniq((u) => u.meta?.city);
  const fDealers = flt.city
    ? uniq((u) => u.meta?.city === flt.city ? u.meta?.store_name : null)
    : uniq((u) => u.meta?.store_name);

  const shown = uploads.filter((u) =>
    (!flt.year   || String(u.meta?.year)   === flt.year) &&
    (!flt.month  || u.meta?.bulan          === flt.month) &&
    (!flt.week   || u.meta?.week           === flt.week) &&
    (!flt.city   || u.meta?.city           === flt.city) &&
    (!flt.dealer || u.meta?.store_name     === flt.dealer) &&
    (!flt.source || u.source               === flt.source)
  );

  // ---------- data per dealer summary ----------
  const dealerStats = (() => {
    const map = new Map<string, { city: string; admin: string; rows: number; sources: Set<string>; periods: Set<string> }>();
    for (const u of uploads) {
      const key = u.meta?.store_name || "—";
      if (!map.has(key)) map.set(key, { city: u.meta?.city || "—", admin: u.meta?.admin || "—", rows: 0, sources: new Set(), periods: new Set() });
      const s = map.get(key)!;
      s.rows += u.row_count || 0;
      s.sources.add(u.source);
      if (u.meta?.bulan) s.periods.add(`${u.meta.bulan}${u.meta.year ? " " + u.meta.year : ""}`);
    }
    return [...map.entries()].map(([dealer, s]) => ({ dealer, ...s })).sort((a,b) => b.rows - a.rows);
  })();

  return (
    <>
      {/* ───── Upload form ───── */}
      <div className="panel">
        <h3 style={{ margin: "0 0 4px" }}>Upload Shopee Data</h3>
        <div className="hint" style={{ marginBottom: 18 }}>
          Pick the week's details once, attach one or more exports (Performa / SPOS / Ads), then Upload. Brand &amp; Tipe Produk are auto-detected from the product/campaign name.
        </div>

        {/* Row 1: Admin | City | PIC Panasonic */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
          <Field label="Admin">
            <select value={form.admin} onChange={(e) => setForm((f) => ({ ...f, admin: e.target.value }))}>
              <option value="">Select admin</option>
              {admins.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="City">
            <select value={form.city} onChange={(e) => pickCity(e.target.value)}>
              <option value="">Select city</option>
              {cities.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
            </select>
          </Field>
          <Field label="PIC Panasonic">
            <select value={form.pic_panasonic} onChange={(e) => setForm((f) => ({ ...f, pic_panasonic: e.target.value }))}>
              <option value="">{form.city ? (form.pic_panasonic || "Select PIC") : "Select PIC"}</option>
              {form.pic_panasonic && <option value={form.pic_panasonic}>{form.pic_panasonic}</option>}
            </select>
          </Field>
        </div>

        {/* Row 2: Dealer | Year | Bulan */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
          <Field label="Dealer">
            <select value={form.dealer} onChange={(e) => setForm((f) => ({ ...f, dealer: e.target.value }))} disabled={!form.city}>
              <option value="">{form.city ? "Select dealer" : "Select city first"}</option>
              {dealers.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Year">
            <select value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))}>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Bulan">
            <select value={form.bulan} onChange={(e) => setForm((f) => ({ ...f, bulan: e.target.value }))}>
              <option value="">Month</option>
              {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>

        {/* Row 3: Week | Tanggal Mulai | Tanggal Berakhir AUTO +6D */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
          <Field label="Week">
            <select value={form.week} onChange={(e) => setForm((f) => ({ ...f, week: e.target.value }))}>
              <option value="">Week</option>
              {WEEKS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Field>
          <Field label="Tanggal Mulai">
            <input type="date" value={form.tanggal_mulai} onChange={(e) => pickStart(e.target.value)} />
          </Field>
          <Field label="Tanggal Berakhir (AUTO +6D)">
            <input type="date" value={form.tanggal_berakhir} readOnly disabled style={{ opacity: .7, cursor: "not-allowed" }} />
          </Field>
        </div>

        {/* Row 4: Tanggal Input (NOW) */}
        <div style={{ marginBottom: 20 }}>
          <Field label="Tanggal Input (NOW)">
            <input type="text" value={tanggal_input} readOnly disabled style={{ opacity: .7, cursor: "not-allowed", width: "33.3%", boxSizing: "border-box" }} />
          </Field>
        </div>

        {/* File pickers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", marginBottom: 20 }}>
          {SLOTS.map((s) => (
            <div key={s.source}>
              <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600 }}>
                {s.label} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>({s.hint})</span>
              </label>
              <input type="file" accept={s.accept} style={{ fontSize: 12, color: "#bcd", display: "block", marginTop: 6, width: "100%" }}
                onChange={(e) => setFiles((f) => ({ ...f, [s.source]: e.target.files?.[0] ?? null }))} />
              {files[s.source] && <p style={{ marginTop: 6, fontSize: 11, color: "var(--gold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {files[s.source]!.name}</p>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center" }}>
          <button className="btn-gold" disabled={busy} onClick={submit} style={{ padding: "11px 60px", fontSize: 15 }}>
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>

        {log.length > 0 && (
          <div style={{ background: "rgba(7,13,26,.8)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, fontFamily: "monospace", fontSize: 12, marginTop: 16 }}>
            {log.map((l, i) => <div key={i} style={{ color: l.startsWith("✓") ? "var(--gold)" : "#f87171", marginBottom: 4 }}>{l}</div>)}
          </div>
        )}
      </div>

      {/* ───── Data per Dealer ───── */}
      {dealerStats.length > 0 && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h3 style={{ margin: "0 0 4px" }}>Data per Dealer</h3>
          <div className="hint">Total rows uploaded per dealer across all sources and periods.</div>
          <div className="tbl-wrap" style={{ marginTop: 14 }}>
            <table className="tbl">
              <thead>
                <tr><th>Dealer</th><th>City</th><th>Admin</th><th className="num">Total Rows</th><th>Sources</th><th>Periods</th></tr>
              </thead>
              <tbody>
                {dealerStats.map((s) => (
                  <tr key={s.dealer}>
                    <td style={{ fontWeight: 600 }}>{s.dealer}</td>
                    <td>{s.city}</td>
                    <td>{s.admin}</td>
                    <td className="num">{s.rows.toLocaleString("id-ID")}</td>
                    <td>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {[...s.sources].map((src) => (
                          <span key={src} style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: SRC_COLOR[src] + "22", color: SRC_COLOR[src], border: `1px solid ${SRC_COLOR[src]}44` }}>
                            {SRC_LABEL[src] || src}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{[...s.periods].slice(0,4).join(", ")}{s.periods.size > 4 ? ` +${s.periods.size-4}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───── Upload Log ───── */}
      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>Upload Log</h3>
            <div className="hint">Filter by period or dealer — delete a bad upload to remove all its rows.</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "3px 12px" }}>
            {shown.length} / {uploads.length}
          </span>
        </div>

        {/* Filter bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 10 }}>
          <Field label="Year"><select value={flt.year}   onChange={(e) => setFlt((f) => ({ ...f, year: e.target.value }))}><option value="">All years</option>{fYears.map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
          <Field label="Month"><select value={flt.month}  onChange={(e) => setFlt((f) => ({ ...f, month: e.target.value }))}><option value="">All months</option>{fMonths.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
          <Field label="Week"><select value={flt.week}   onChange={(e) => setFlt((f) => ({ ...f, week: e.target.value }))}><option value="">All weeks</option>{fWeeks.map((w) => <option key={w} value={w}>{w}</option>)}</select></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr) auto", gap: 10, marginBottom: 14, alignItems: "end" }}>
          <Field label="City"><select value={flt.city}   onChange={(e) => setFlt((f) => ({ ...f, city: e.target.value, dealer: "" }))}><option value="">All cities</option>{fCities.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Dealer"><select value={flt.dealer} onChange={(e) => setFlt((f) => ({ ...f, dealer: e.target.value }))}><option value="">All dealers</option>{fDealers.map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
          <Field label="Source"><select value={flt.source} onChange={(e) => setFlt((f) => ({ ...f, source: e.target.value }))}><option value="">All sources</option>{SLOTS.map((s) => <option key={s.source} value={s.source}>{s.label}</option>)}</select></Field>
          <button className="btn-ghost" onClick={() => setFlt({ year: "", month: "", week: "", city: "", dealer: "", source: "" })} style={{ height: 38 }}>Reset</button>
        </div>

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Admin</th><th>Dealer</th><th>City</th><th>Source</th>
                <th>Month</th><th>Week</th><th>Year</th>
                <th className="num">Rows</th><th>File</th><th>Uploaded</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td>{u.meta?.admin || "—"}</td>
                  <td>{u.meta?.store_name || "—"}</td>
                  <td>{u.meta?.city || "—"}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: SRC_COLOR[u.source] + "22", color: SRC_COLOR[u.source], border: `1px solid ${SRC_COLOR[u.source]}44` }}>
                      {SRC_LABEL[u.source] || u.source}
                    </span>
                  </td>
                  <td>{u.meta?.bulan || "—"}</td>
                  <td>{u.meta?.week || "—"}</td>
                  <td>{u.meta?.year || "—"}</td>
                  <td className="num">{u.row_count?.toLocaleString("id-ID") || 0}</td>
                  <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.filename || ""}>{u.filename || "—"}</td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{new Date(u.created_at).toLocaleDateString("id-ID")}</td>
                  <td><button onClick={() => delUpload(u.id)} style={delBtnStyle}>Delete</button></td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={11} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>
                  {uploads.length ? "No uploads match these filters" : "No uploads yet"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const delBtnStyle: React.CSSProperties = { background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)", color: "#ff9a9a", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fld" style={{ minWidth: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}
