"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DataSource } from "@/lib/parse";

export const dynamic = "force-dynamic";

// Store Performance — posted to /api/upload.
const SLOTS: { source: DataSource; label: string; hint: string; accept: string }[] = [
  { source: "perf", label: "Performa", hint: "sales_overview",       accept: ".xlsx,.xls,.csv" },
  { source: "spos", label: "SPOS",     hint: "parentskudetail",      accept: ".xlsx,.xls,.csv" },
];

// Ads Performance — 3 slots, 1 shared Upload button. "ads" still posts to
// /api/upload (flat, whole-account totals); the other two post to
// /api/ads-group/upload (the "Data Grup Iklan / Shop GMV Max" matrix export).
type AdSlotKey = "ads" | "gmvmax" | "group";
const AD_SLOTS: { key: AdSlotKey; label: string; hint: string; accept: string; adsLevel?: string }[] = [
  { key: "ads",    label: "Ads Performa",       hint: "Data Keseluruhan Iklan", accept: ".xlsx,.xls,.csv" },
  { key: "gmvmax", label: "GMV Auto Performa",  hint: "Inkubasi / Shop GMV Max", accept: ".xlsx,.xls,.csv", adsLevel: "incubation" },
  { key: "group",  label: "Group Ads Performa", hint: "Data Grup Iklan",         accept: ".xlsx,.xls,.csv" },
];

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember","Month Awal"];
const WEEKS  = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
const THIS_YEAR = new Date().getFullYear();
const YEARS  = Array.from({ length: 6 }, (_, i) => THIS_YEAR - 2 + i); // 4 past + current + 1 future

// One badge per (source, ad-sub-kind) — the "ads" DataSource fans out into 3
// sub-kinds distinguished by meta.kind/meta.ads_level (see subKey below).
const BADGES: { key: string; label: string; color: string }[] = [
  { key: "perf",   label: "Performa",   color: "#22c55e" },
  { key: "spos",   label: "SPOS",       color: "#3b82f6" },
  { key: "ads",    label: "Ads",        color: "#f59e0b" },
  { key: "gmvmax", label: "GMV Auto",   color: "#a855f7" },
  { key: "group",  label: "Group Ads",  color: "#ec4899" },
];
function subKey(u: UploadRow): string {
  if (u.source !== "ads") return u.source;
  if (u.meta?.kind === "ads_group") return u.meta?.ads_level === "incubation" ? "gmvmax" : "group";
  return "ads";
}

const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 2 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));

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
  meta: { admin?: string; city?: string; pic_client?: string; store_name?: string; bulan?: string; week?: string; year?: number; kind?: string; ads_level?: string } | null;
};
type DealerRow = {
  store_name: string; city: string; sales: number; traffic: number; in_cart: number; ad_cost: number;
  roas: number | null; trend: { year: number | null; month: string; sales: number }[];
};
// What an upload ACTUALLY contains, derived from its data rows by the
// upload_coverage() RPC — the only reliable source for bulk re-imports,
// whose meta carries no month/city/dealer at all.
type Coverage = { months: string[]; cities: string[]; stores: string[]; weeks: string[]; years: string[]; rows: number };
// One row per (city, dealer, year, month, week) — the source files
// that make up a single upload batch collapsed into one line. Bulk
// re-imports instead get one row per file, described by `cov`.
type Batch = {
  key: string; city: string; dealer: string; year: number | null; month: string; week: string;
  admin: string; latest: string;
  bySource: Partial<Record<string, UploadRow>>;
  cov?: Coverage;
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
  const [coverage, setCoverage] = useState<Record<string, Coverage>>({});
  const [dealerRows, setDealerRows] = useState<DealerRow[]>([]);
  const [flt,     setFlt]     = useState({ year: "", month: "", week: "", city: "", dealer: "", source: "" }); // city/source kept for reset compat

  // load uploads + what each one actually contains
  const loadUploads = useCallback(async (cid: string) => {
    if (!cid) return;
    const [{ data }, { data: cov }] = await Promise.all([
      supabase.from("uploads")
        .select("id,source,filename,row_count,created_at,meta")
        .eq("client_id", cid)
        .order("created_at", { ascending: false }),
      supabase.rpc("upload_coverage"),
    ]);
    setUploads((data as UploadRow[]) || []);
    setCoverage((cov as Record<string, Coverage>) || {});
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

      // real per-dealer analytics — same source as the Dashboard's
      // "Detail Data per Dealer" panel, not raw upload-metadata counts.
      const { data: snap } = await supabase.rpc("get_dashboard_snapshot");
      setDealerRows(((snap as { dealers?: DealerRow[] } | null)?.dealers) || []);
    })();
  }, [supabase, loadUploads]);

  // when city changes: auto-fill PIC + reload dealers
  async function pickCity(city: string) {
    const pic = cities.find((c) => c.value === city)?.pic || "";
    setForm((f) => ({ ...f, city, pic_panasonic: pic, dealer: "" }));
    if (!city || !clientId) { setDealers([]); return; }
    const { data } = await supabase.from("master_data")
      .select("value").eq("kind", "store").eq("client_id", clientId).eq("city", city).order("value");
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
    const chosenSlots   = SLOTS.filter((s) => files[s.source]);
    const chosenAdSlots = AD_SLOTS.filter((s) => files[s.key]);
    if (!chosenSlots.length && !chosenAdSlots.length) { setLog(["Pick at least one file."]); setBusy(false); return; }
    const manualBase = {
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
    for (const slot of chosenSlots) {
      const fd = new FormData();
      fd.append("file", files[slot.source]!);
      fd.append("source", slot.source);
      fd.append("manual", JSON.stringify(manualBase));
      fd.append("client_id", clientId);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const j = await res.json();
        setLog((l) => [...l, res.ok ? `✓ ${slot.label}: ${j.rows} rows` : `✗ ${slot.label}: ${j.error}`]);
      } catch (e) {
        setLog((l) => [...l, `✗ ${slot.label}: ${String(e)}`]);
      }
    }
    for (const slot of chosenAdSlots) {
      const fd = new FormData();
      fd.append("file", files[slot.key]!);
      if (slot.key === "ads") {
        // flat "Data Keseluruhan Iklan" export — same endpoint as SLOTS.
        fd.append("source", "ads");
        fd.append("manual", JSON.stringify(manualBase));
        fd.append("client_id", clientId);
        try {
          const res = await fetch("/api/upload", { method: "POST", body: fd });
          const j = await res.json();
          setLog((l) => [...l, res.ok ? `✓ ${slot.label}: ${j.rows} rows` : `✗ ${slot.label}: ${j.error}`]);
        } catch (e) {
          setLog((l) => [...l, `✗ ${slot.label}: ${String(e)}`]);
        }
      } else {
        // GMV Auto / Group Ads — the "Data Grup Iklan" matrix export.
        fd.append("manual", JSON.stringify({ ...manualBase, ads_level: slot.adsLevel }));
        fd.append("client_id", clientId);
        try {
          const res = await fetch("/api/ads-group/upload", { method: "POST", body: fd });
          const j = await res.json();
          setLog((l) => [...l, res.ok ? `✓ ${slot.label}: ${j.rows} rows` : `✗ ${slot.label}: ${j.error}`]);
        } catch (e) {
          setLog((l) => [...l, `✗ ${slot.label}: ${String(e)}`]);
        }
      }
    }
    setBusy(false);
    loadUploads(clientId);
  }

  // Deletes every source (Performa/Ads/SPOS) that makes up one batch row.
  async function delBatch(batch: Batch) {
    const ids = Object.values(batch.bySource).map((u) => u!.id);
    if (!ids.length) return;
    // A bulk re-import row is one file covering a whole quarter x region —
    // deleting it wipes many dealers/months at once, so spell that out
    // instead of showing the batch's placeholder "—" fields.
    const label = batch.cov
      ? `${Object.values(batch.bySource)[0]?.filename ?? "bulk import"}\n\n` +
        `Covers ${batch.cov.stores.length} dealer(s), months: ${batch.cov.months.join(", ") || "—"}\n` +
        `${batch.cov.rows.toLocaleString("id-ID")} data row(s) will be removed.`
      : [batch.dealer, batch.month, batch.week].filter(Boolean).join(" · ");
    if (!confirm(`Delete all data for "${label}"? This removes ${ids.length} file(s) and cannot be undone.`)) return;
    const { error } = await supabase.from("uploads").delete().in("id", ids);
    if (error) { alert(error.message); return; }
    loadUploads(clientId);
  }

  // ---------- group uploads into log rows ----------
  // Two kinds of upload live in this table and they need different
  // treatment (this is why the Month filter used to match nothing for
  // baseline data — see Supabase Migration/33-upload-coverage.sql):
  //   * App-form uploads carry meta.bulan/city/store_name, so one upload
  //     == one (city, dealer, year, month, week) batch — grouped as before.
  //   * Bulk re-imports carry only {year, region, quarter}; a single file
  //     spans a whole quarter x region (many dealers, many months,
  //     including "Month Awal"). Those get one row each, described by
  //     their REAL coverage from upload_coverage().
  const batches: Batch[] = (() => {
    const map = new Map<string, Batch>();
    for (const u of uploads) {
      const cov = coverage[u.id];
      if (!u.meta?.bulan && cov) {
        map.set(u.id, {
          key: u.id, city: cov.cities.join(", ") || "—", dealer: "—",
          year: cov.years.length === 1 ? Number(cov.years[0]) : (u.meta?.year ?? null),
          month: "—", week: "—",
          admin: u.meta?.admin || "Bulk import", latest: u.created_at,
          bySource: { [subKey(u)]: u }, cov,
        });
        continue;
      }
      const city = u.meta?.city || "—";
      const dealer = u.meta?.store_name || "—";
      const year = u.meta?.year ?? null;
      const month = u.meta?.bulan || "—";
      const week = u.meta?.week || "—";
      const key = `${city}|${dealer}|${year}|${month}|${week}`;
      if (!map.has(key)) {
        map.set(key, { key, city, dealer, year, month, week, admin: u.meta?.admin || "—", latest: u.created_at, bySource: {} });
      }
      const b = map.get(key)!;
      b.bySource[subKey(u)] = u;
      if (u.created_at > b.latest) b.latest = u.created_at;
      if (!b.admin || b.admin === "—") b.admin = u.meta?.admin || b.admin;
    }
    return [...map.values()].sort((a, b) => b.latest.localeCompare(a.latest));
  })();

  // ---------- upload log filter options ----------
  // Options come from BOTH meta (app uploads) and real coverage (bulk
  // imports), so e.g. "Month Awal" appears because data actually has it.
  const covs = Object.values(coverage);
  const opts = (fromMeta: (u: UploadRow) => string | number | undefined | null, fromCov: (c: Coverage) => string[]) =>
    Array.from(new Set([
      ...uploads.map(fromMeta).filter((v) => v != null && v !== "").map(String),
      ...covs.flatMap(fromCov),
    ])).sort();
  const fYears   = opts((u) => u.meta?.year, (c) => c.years).sort((a, b) => b.localeCompare(a));
  const fMonths  = opts((u) => u.meta?.bulan, (c) => c.months);
  const fWeeks   = opts((u) => u.meta?.week, (c) => c.weeks);
  const fDealers = opts((u) => u.meta?.store_name, (c) => c.stores);

  // A bulk-import row matches a filter if its coverage CONTAINS the value;
  // an app-form row matches on exact equality as before.
  const hit = (b: Batch, val: string, exact: string | null, covKey: keyof Coverage) =>
    !val || (b.cov ? (b.cov[covKey] as string[]).includes(val) : exact === val);

  const shownBatches = batches.filter((b) =>
    hit(b, flt.year,   b.year == null ? null : String(b.year), "years") &&
    hit(b, flt.month,  b.month,  "months") &&
    hit(b, flt.week,   b.week,   "weeks") &&
    hit(b, flt.dealer, b.dealer, "stores")
  );

  function fmtWhen(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
      + " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <>
      {/* ───── Upload form ───── */}
      <div className="panel">
        <h3 style={{ margin: "0 0 4px" }}>Upload Shopee Data</h3>
        <div className="hint" style={{ marginBottom: 18 }}>
          Pick the week's details once, attach one or more exports (Performa / SPOS / Ads Performa / GMV Auto Performa / Group Ads Performa), then Upload. Brand &amp; Tipe Produk are auto-detected from the product/campaign name.
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

        {/* Store Performance */}
        <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 700, color: "#cdd9f0" }}>Store Performance</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", marginBottom: 20 }}>
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

        {/* Ads Performance — 3 parts */}
        <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 700, color: "#cdd9f0" }}>Ads Performance</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", marginBottom: 20 }}>
          {AD_SLOTS.map((s) => (
            <div key={s.key}>
              <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600 }}>
                {s.label} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>({s.hint})</span>
              </label>
              <input type="file" accept={s.accept} style={{ fontSize: 12, color: "#bcd", display: "block", marginTop: 6, width: "100%" }}
                onChange={(e) => setFiles((f) => ({ ...f, [s.key]: e.target.files?.[0] ?? null }))} />
              {files[s.key] && <p style={{ marginTop: 6, fontSize: 11, color: "var(--gold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {files[s.key]!.name}</p>}
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
      {dealerRows.length > 0 && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h3 style={{ margin: "0 0 4px" }}>Data per Dealer</h3>
          <div className="hint">Sorted by sales — mirrors the Dashboard&apos;s Detail Data per Dealer.</div>
          <div className="tbl-wrap" style={{ marginTop: 14, maxHeight: 440 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Dealer</th><th style={{ width: 90 }}>Trend</th><th>City</th><th className="num">Sales</th><th className="num">Traffic</th>
                  <th className="num">In-Cart</th><th className="num">Cart Rate</th><th className="num">Ads Cost</th><th className="num">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {dealerRows.map((r, i) => {
                  const cr = r.traffic ? (r.in_cart / r.traffic) * 100 : 0;
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{r.store_name}</td>
                      <td><Sparkline id={`up-spark-${i}`} points={(r.trend || []).map((t) => t.sales)} /></td>
                      <td>{r.city || "—"}</td>
                      <td className="num">{idr(r.sales)}</td>
                      <td className="num">{num(r.traffic)}</td>
                      <td className="num">{num(r.in_cart)}</td>
                      <td className="num">{cr.toFixed(1)}%</td>
                      <td className="num">{idr(r.ad_cost)}</td>
                      <td className="num"><span className={`pill ${!r.roas ? "" : r.roas >= 3 ? "good" : r.roas >= 1 ? "warn" : "bad"}`}>{r.roas ? r.roas.toFixed(2) + "×" : "—"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───── Upload Log ───── */}
      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Upload Log</h3>
          <div className="hint">Every upload is recorded. Delete an entry to remove its table &amp; data (use this if a file uploaded wrong).</div>
        </div>

        {/* Filter bar — Year / Month / Week / Dealer */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr) auto auto", gap: 10, marginBottom: 14, alignItems: "end" }}>
          <Field label="Year"><select value={flt.year}   onChange={(e) => setFlt((f) => ({ ...f, year: e.target.value }))}><option value="">All Years</option>{fYears.map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
          <Field label="Month"><select value={flt.month}  onChange={(e) => setFlt((f) => ({ ...f, month: e.target.value }))}><option value="">All Months</option>{fMonths.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
          <Field label="Week"><select value={flt.week}   onChange={(e) => setFlt((f) => ({ ...f, week: e.target.value }))}><option value="">All Weeks</option>{fWeeks.map((w) => <option key={w} value={w}>{w}</option>)}</select></Field>
          <Field label="Dealer"><select value={flt.dealer} onChange={(e) => setFlt((f) => ({ ...f, dealer: e.target.value }))}><option value="">All Dealers</option>{fDealers.map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
          <button className="btn-ghost" onClick={() => setFlt({ year: "", month: "", week: "", city: "", dealer: "", source: "" })} style={{ height: 38, alignSelf: "end" }}>Reset</button>
          <span style={{ alignSelf: "end", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", paddingBottom: 8 }}>{shownBatches.length} rows</span>
        </div>

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Time Upload</th><th>Month</th><th>Week</th><th>Admin</th><th>File</th>
                <th>Tipe</th><th>City</th><th>Dealer</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shownBatches.map((b) => (
                <tr key={b.key}>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{fmtWhen(b.latest)}</td>
                  <td><MonthCell b={b} /></td>
                  <td>{b.cov ? <Multi items={b.cov.weeks} /> : b.week}</td>
                  <td>{b.admin}</td>
                  <td style={{ fontSize: 11, color: "var(--muted)", maxWidth: 200 }}>
                    {BADGES.map((s) => {
                      const u = b.bySource[s.key];
                      if (!u) return null;
                      return (
                        <div key={s.key} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.filename || ""}>
                          {u.filename || "—"}
                        </div>
                      );
                    })}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {BADGES.map((s) => {
                        const present = !!b.bySource[s.key];
                        const color = s.color;
                        return (
                          <span key={s.key} style={{
                            fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                            background: present ? color + "22" : "rgba(255,255,255,.05)",
                            color: present ? color : "var(--muted)",
                            border: `1px solid ${present ? color + "44" : "rgba(255,255,255,.1)"}`,
                          }}>
                            {s.label}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td>{b.city}</td>
                  <td style={{ fontWeight: 600 }}>
                    {b.cov
                      ? (b.cov.rows === 0
                          ? <span style={{ fontWeight: 400, fontSize: 11, color: "#f87171" }} title="Audit row with no surviving data — leftover from a re-import">⚠ empty (0 rows)</span>
                          : <Multi items={b.cov.stores} />)
                      : b.dealer}
                  </td>
                  <td><button onClick={() => delBatch(b)} style={delBtnStyle}>Delete</button></td>
                </tr>
              ))}
              {shownBatches.length === 0 && (
                <tr><td colSpan={9} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>
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

const awalPill: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
  background: "rgba(201,162,39,.18)", color: "var(--gold)", border: "1px solid rgba(201,162,39,.4)",
};

// A bulk import spans many months/weeks/dealers — show the first couple and
// a "+N" rather than a wall of text; full list on hover.
function Multi({ items }: { items: string[] }) {
  if (!items.length) return <span style={{ color: "var(--muted)" }}>—</span>;
  const head = items.slice(0, 2).join(", ");
  return (
    <span title={items.join(", ")} style={{ fontSize: 12 }}>
      {head}{items.length > 2 && <span style={{ color: "var(--muted)" }}> +{items.length - 2}</span>}
    </span>
  );
}

// Baseline ("Month Awal") is called out with a pill wherever it appears —
// including inside a bulk import that also covers ordinary months.
function MonthCell({ b }: { b: Batch }) {
  if (!b.cov) {
    return b.month === "Month Awal" ? <span style={awalPill}>🏁 {b.month}</span> : <>{b.month}</>;
  }
  const awal = b.cov.months.filter((m) => /awal/i.test(m));
  const rest = b.cov.months.filter((m) => !/awal/i.test(m));
  return (
    <span title={b.cov.months.join(", ")} style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      {awal.length > 0 && <span style={awalPill}>🏁 Month Awal</span>}
      {rest.length > 0 && <Multi items={rest} />}
      {b.cov.months.length === 0 && <span style={{ color: "var(--muted)" }}>—</span>}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fld" style={{ minWidth: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function Sparkline({ id, points, width = 84, height = 30 }: { id: string; points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <span style={{ display: "inline-block", width, height }} />;
  const pad = 4;
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => [pad + i * stepX, pad + (height - pad * 2) * (1 - (p - min) / range)] as const);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1][0].toFixed(1)} ${height} L ${coords[0][0].toFixed(1)} ${height} Z`;
  const up = points[points.length - 1] >= points[0];
  const color = up ? "#4ade80" : "#f87171";
  const [lastX, lastY] = coords[coords.length - 1];
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.45} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
        <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.4" floodColor={color} floodOpacity="0.85" />
        </filter>
      </defs>
      <path d={areaPath} fill={`url(#${id}-fill)`} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.4} fill={color} filter={`url(#${id}-glow)`} />
    </svg>
  );
}
