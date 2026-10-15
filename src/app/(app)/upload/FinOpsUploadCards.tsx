"use client";

import { useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import ImageGuideModal from "@/components/ImageGuideModal";
import { GUIDE } from "@/lib/uploadGuides";

// Two self-contained upload cards — Earning (Shopee "Laporan Penghasilan") and
// Demographic (Shopee "Order.completed") — each with its own Year / Month /
// City / Dealer, its own file and its own Upload button, side by side. Each
// posts to its own endpoint. No description text: the image guide shows how to
// download the file from Shopee.

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const THIS_YEAR = new Date().getFullYear();

type Supabase = ReturnType<typeof createClient>;
type CityRow = { value: string; pic: string | null };
type UploadJson = { rows?: number; product_lines?: number; unreconciled_orders?: number; error?: string };

export default function FinOpsUploadCards({ supabase, clientId, cities, onDone }: {
  supabase: Supabase; clientId: string; cities: CityRow[]; onDone: () => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 20, marginTop: 20, alignItems: "start" }}>
      <UploadCard
        supabase={supabase} clientId={clientId} cities={cities} onDone={onDone}
        title="Earning" roles="Super Admin | Admin"
        endpoint="/api/finance/upload"
        fileLabel="Earning" fileHint="(Laporan Penghasilan)"
        guide={GUIDE.finance}
        okMessage={(j) => [
          `✓ ${j.rows} rows${j.product_lines ? ` · ${j.product_lines} product lines (real per-product costs)` : ""}`,
          ...(j.unreconciled_orders ? [`⚠ ${j.unreconciled_orders} order(s) do not add up to Shopee's Total Penghasilan — check the file`] : []),
        ]}
      />
      <UploadCard
        supabase={supabase} clientId={clientId} cities={cities} onDone={onDone}
        title="Demographic" roles="Super Admin | Admin"
        endpoint="/api/store/upload"
        fileLabel="Order Completed" fileHint="(Order.completed)"
        guide={GUIDE.order}
        okMessage={(j) => [`✓ ${j.rows} rows`]}
      />
    </div>
  );
}

function UploadCard({ supabase, clientId, cities, onDone, title, roles, endpoint, fileLabel, fileHint, guide, okMessage }: {
  supabase: Supabase; clientId: string; cities: CityRow[]; onDone: () => void;
  title: string; roles: string; endpoint: string; fileLabel: string; fileHint: string; guide: string;
  okMessage: (j: UploadJson) => string[];
}) {
  const [year, setYear] = useState(THIS_YEAR);
  const [bulan, setBulan] = useState("");
  const [city, setCity] = useState("");
  const [dealer, setDealer] = useState("");
  const [dealers, setDealers] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function pickCity(c: string) {
    setCity(c); setDealer("");
    if (!c || !clientId) { setDealers([]); return; }
    const { data } = await supabase.from("master_data")
      .select("value").eq("kind", "store").eq("client_id", clientId).eq("city", c).order("value");
    setDealers(((data as { value: string }[]) || []).map((d) => d.value));
  }

  async function submit() {
    if (!clientId) { setLog(["✗ Workspace not ready."]); return; }
    if (!bulan || !city || !dealer) { setLog(["✗ Pick Month, City and Dealer first."]); return; }
    if (!file) { setLog(["✗ Choose a file first."]); return; }
    setBusy(true); setLog([]);
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
      const j: UploadJson = await res.json().catch(() => ({}));
      if (res.ok) { setLog(okMessage(j)); setFile(null); onDone(); }
      else setLog(["✗ " + (j.error || `Upload failed (${res.status})`)]);
    } catch (e) { setLog(["✗ " + String(e)]); }
    setBusy(false);
  }

  return (
    <div className="panel" style={{ margin: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{roles}</span>
      </div>

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
        <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600, display: "block", marginBottom: 4 }}>
          {fileLabel} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>{fileHint}</span>
        </label>
        <ImageGuideModal image={guide} />
        <input type="file" accept=".xlsx,.xls" style={{ fontSize: 12, color: "#bcd", display: "block", width: "100%" }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <p style={{ marginTop: 6, fontSize: 11, color: "var(--gold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {file.name}</p>}
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <button className="btn-gold" disabled={busy} onClick={submit} style={{ padding: "11px 40px", fontSize: 15 }}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>

      {log.length > 0 && (
        <div style={{ background: "rgba(7,13,26,.8)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, fontFamily: "monospace", fontSize: 12, marginTop: 16, wordBreak: "break-word" }}>
          {log.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("✓") ? "var(--gold)" : l.startsWith("⚠") ? "#fbbf24" : "#f87171", marginBottom: 4 }}>{l}</div>
          ))}
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
