"use client";

import { useState } from "react";
import type { createClient } from "@/lib/supabase/client";

// Two self-contained upload cards — Finance Detail (Shopee "Laporan
// Penghasilan") and Operational Performance (Shopee "Order.completed") — each
// with its own Year / Month / City / Dealer, its own file and its own Upload
// button, side by side. Each posts to its own endpoint.

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const THIS_YEAR = new Date().getFullYear();

type Supabase = ReturnType<typeof createClient>;
type CityRow = { value: string; pic: string | null };

export default function FinOpsUploadCards({ supabase, clientId, cities, onDone }: {
  supabase: Supabase; clientId: string; cities: CityRow[]; onDone: () => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 20, marginTop: 20, alignItems: "start" }}>
      <section>
        <SectionTitle title="Finance Detail" tiers="Super Admin | Admin" />
        <UploadCard
          supabase={supabase} clientId={clientId} cities={cities} onDone={onDone}
          heading="Upload Keuangan"
          endpoint="/api/finance/upload"
          fileLabel="Income Report"
          fileHint="(Laporan Penghasilan)"
          manualHref="/manuals/Manual-Book-Ambil-Report-Keuangan-Shopee.pdf"
          intro={<>Upload the Shopee &quot;Laporan Penghasilan&quot; (Income) export — the &quot;Income&quot; or &quot;Penghasilan&quot; sheet is read automatically, so the Excel file can be uploaded as it is (no CSV needed). The newer &quot;Penghasilan&quot; layout also gives real per-product costs (and Pajak) for Detail Product Profit. Week is auto-detected per transaction from its release date (Week 1 = days 1–7 of the month you pick, Week 5 may spill a few days into the next month).</>}
          okMessage={(j) => `✓ ${j.rows} transactions imported${j.products ? ` · ${j.products} product rows (real per-product costs + Pajak)` : ""}`}
        />
      </section>
      <section>
        <SectionTitle title="Operational Performance" tiers="Super Admin | Admin" />
        <UploadCard
          supabase={supabase} clientId={clientId} cities={cities} onDone={onDone}
          heading="Upload Operational Performance"
          endpoint="/api/store/upload"
          fileLabel="Order Report"
          fileHint="(Order.completed)"
          intro={<>Upload the Shopee &quot;Order.completed&quot; (order-level) export — the sheet is read automatically. Week is auto-detected per order from its completion date (Week 1 = days 1–7 of the month you pick).</>}
          okMessage={(j) => `✓ ${j.rows} order lines imported`}
        />
      </section>
    </div>
  );
}

function SectionTitle({ title, tiers }: { title: string; tiers: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", margin: "0 0 8px 4px" }}>
      <span style={{ fontSize: 16, fontWeight: 800, color: "var(--gold)" }}>{title}</span>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{tiers}</span>
    </div>
  );
}

function UploadCard({ supabase, clientId, cities, onDone, heading, endpoint, fileLabel, fileHint, intro, manualHref, okMessage }: {
  supabase: Supabase; clientId: string; cities: CityRow[]; onDone: () => void;
  heading: string; endpoint: string; fileLabel: string; fileHint: string;
  intro: React.ReactNode; manualHref?: string;
  okMessage: (j: { rows?: number; products?: number }) => string;
}) {
  const [year, setYear] = useState(THIS_YEAR);
  const [bulan, setBulan] = useState("");
  const [city, setCity] = useState("");
  const [dealer, setDealer] = useState("");
  const [dealers, setDealers] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  async function pickCity(c: string) {
    setCity(c); setDealer("");
    if (!c || !clientId) { setDealers([]); return; }
    const { data } = await supabase.from("master_data")
      .select("value").eq("kind", "store").eq("client_id", clientId).eq("city", c).order("value");
    setDealers(((data as { value: string }[]) || []).map((d) => d.value));
  }

  async function submit() {
    if (!clientId) { setLog("✗ Workspace not ready."); return; }
    if (!bulan || !city || !dealer) { setLog("✗ Pick Month, City and Dealer first."); return; }
    if (!file) { setLog("✗ Choose a file first."); return; }
    setBusy(true); setLog("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("client_id", clientId);
    fd.append("manual", JSON.stringify({
      year, bulan, city,
      pic_client: cities.find((c) => c.value === city)?.pic || "",
      store_name: dealer,
    }));
    try {
      const res = await fetch(endpoint, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (res.ok) { setLog(okMessage(j)); setFile(null); onDone(); }
      else setLog("✗ " + (j.error || `Upload failed (${res.status})`));
    } catch (e) { setLog("✗ " + String(e)); }
    setBusy(false);
  }

  return (
    <div className="panel" style={{ margin: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>{heading}</h3>
        {manualHref && (
          <a href={manualHref} download style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, textDecoration: "none",
            color: "var(--navy-deep)", background: "linear-gradient(135deg,var(--gold),var(--gold-soft))",
            padding: "8px 14px", borderRadius: 999,
          }}>⬇ Download Cara Ambil Report Keuangan dari Shopee</a>
        )}
      </div>
      <div className="hint" style={{ marginBottom: 16 }}>{intro}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14, marginBottom: 14 }}>
        <Field label="Year">
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </Field>
        <Field label="Bulan">
          <select value={bulan} onChange={(e) => setBulan(e.target.value)}>
            <option value="">Month</option>
            {MONTHS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <Field label="City">
          <select value={city} onChange={(e) => pickCity(e.target.value)}>
            <option value="">Select city…</option>
            {cities.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
          </select>
        </Field>
        <Field label="Dealer">
          <select value={dealer} onChange={(e) => setDealer(e.target.value)} disabled={!city}>
            <option value="">{city ? "Select dealer…" : "Pick city first"}</option>
            {dealers.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600 }}>
          {fileLabel} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>{fileHint}</span>
        </label>
        <input type="file" accept=".xlsx,.xls" style={{ fontSize: 12, color: "#bcd", display: "block", marginTop: 6, width: "100%" }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <p style={{ marginTop: 6, fontSize: 11, color: "var(--gold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {file.name}</p>}
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <button className="btn-gold" disabled={busy} onClick={submit} style={{ padding: "11px 40px", fontSize: 15 }}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>

      {log && (
        <div style={{ background: "rgba(7,13,26,.8)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, fontFamily: "monospace", fontSize: 12, marginTop: 16, color: log.startsWith("✓") ? "var(--gold)" : "#f87171", wordBreak: "break-word" }}>
          {log}
        </div>
      )}
    </div>
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
