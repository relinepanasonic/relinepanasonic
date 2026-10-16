"use client";

import { useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import ImageGuideModal from "@/components/ImageGuideModal";
import { GUIDE } from "@/lib/uploadGuides";

// Two self-contained upload cards, side by side:
//  - Earning (Shopee "Laporan Penghasilan")
//  - Demographic: ONE card with Order Shipping (left) and Order Completed (right),
//    sharing one Year / Month / City / Dealer and one Upload button (the two daily files).
// Each file posts to its own endpoint. No description text: the image guide shows how
// to download the file from Shopee.

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const THIS_YEAR = new Date().getFullYear();

type Supabase = ReturnType<typeof createClient>;
type CityRow = { value: string; pic: string | null };
type UploadJson = { rows?: number; product_lines?: number; unreconciled_orders?: number; empty?: boolean; skipped_orders?: number; error?: string };
type Slot = {
  key: string; endpoint: string; fileLabel: string; fileHint: string; guide?: string;
  okMessage: (j: UploadJson) => string[];
};

const EARNING_SLOT: Slot = {
  key: "earning", endpoint: "/api/finance/upload",
  fileLabel: "Earning", fileHint: "(Laporan Penghasilan)", guide: GUIDE.finance,
  okMessage: (j) => [
    `✓ ${j.rows} rows${j.product_lines ? ` · ${j.product_lines} product lines (real per-product costs)` : ""}`,
    ...(j.unreconciled_orders ? [`⚠ ${j.unreconciled_orders} order(s) do not add up to Shopee's Total Penghasilan — check the file`] : []),
  ],
};
const SHIPPING_SLOT: Slot = {
  key: "shipping", endpoint: "/api/store/ship-upload",
  fileLabel: "Order Shipping", fileHint: "(Order.shipping)",
  okMessage: (j) => [
    j.empty ? "✓ The file has no orders — nothing to save" : `✓ ${j.rows} rows`,
    ...(j.skipped_orders ? [`↷ ${j.skipped_orders} order(s) were already uploaded and were skipped`] : []),
  ],
};
const COMPLETED_SLOT: Slot = {
  key: "completed", endpoint: "/api/store/upload",
  fileLabel: "Order Completed", fileHint: "(Order.completed)", guide: GUIDE.order,
  okMessage: (j) => [j.empty ? "✓ The file has no orders (nothing completed in that range) — nothing to save" : `✓ ${j.rows} rows`],
};

export default function FinOpsUploadCards({ supabase, clientId, cities, onDone }: {
  supabase: Supabase; clientId: string; cities: CityRow[]; onDone: () => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 20, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 380px", minWidth: 0 }}>
        <UploadCard supabase={supabase} clientId={clientId} cities={cities} onDone={onDone}
          title="Earning" roles="Super Admin | Admin" slots={[EARNING_SLOT]} />
      </div>
      <div style={{ flex: "1.7 1 640px", minWidth: 0 }}>
        <UploadCard supabase={supabase} clientId={clientId} cities={cities} onDone={onDone}
          title="Demographic" roles="Super Admin | Admin" slots={[SHIPPING_SLOT, COMPLETED_SLOT]} />
      </div>
    </div>
  );
}

function UploadCard({ supabase, clientId, cities, onDone, title, roles, slots }: {
  supabase: Supabase; clientId: string; cities: CityRow[]; onDone: () => void;
  title: string; roles: string; slots: Slot[];
}) {
  const [year, setYear] = useState(THIS_YEAR);
  const [bulan, setBulan] = useState("");
  const [city, setCity] = useState("");
  const [dealer, setDealer] = useState("");
  const [dealers, setDealers] = useState<string[]>([]);
  const [files, setFiles] = useState<Record<string, File | null>>({});
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
    const chosen = slots.filter((s) => files[s.key]);
    if (!chosen.length) { setLog(["✗ Choose a file first."]); return; }
    setBusy(true); setLog([]);
    const manual = JSON.stringify({
      year, bulan, city,
      pic_client: cities.find((c) => c.value === city)?.pic || "",
      store_name: dealer,
    });
    const out: string[] = [];
    let anyOk = false;
    // one file after the other, each to its own endpoint; a failed one does not stop the other
    for (const s of chosen) {
      const fd = new FormData();
      fd.append("file", files[s.key]!);
      fd.append("client_id", clientId);
      fd.append("manual", manual);
      const prefix = slots.length > 1 ? `${s.fileLabel}: ` : "";
      try {
        const res = await fetch(s.endpoint, { method: "POST", body: fd });
        const j: UploadJson = await res.json().catch(() => ({}));
        if (res.ok) {
          anyOk = true;
          out.push(...s.okMessage(j).map((m) => m.replace(/^(\S+) /, `$1 ${prefix}`)));
          setFiles((f) => ({ ...f, [s.key]: null }));
        } else out.push("✗ " + prefix + (j.error || `Upload failed (${res.status})`));
      } catch (e) { out.push("✗ " + prefix + String(e)); }
    }
    setLog(out);
    if (anyOk) onDone();
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

      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit,minmax(min(100%,${slots.length > 1 ? 260 : 320}px),1fr))`, gap: 14, marginBottom: 20 }}>
        {slots.map((s) => (
          <div key={s.key} style={{ padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600, display: "block", marginBottom: 4 }}>
              {s.fileLabel} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>{s.fileHint}</span>
            </label>
            <input type="file" accept=".xlsx,.xls" className="file-gold" style={{ fontSize: 12, display: "block", width: "100%" }}
              onChange={(e) => setFiles((f) => ({ ...f, [s.key]: e.target.files?.[0] ?? null }))} />
            {files[s.key] && <p style={{ marginTop: 6, fontSize: 11, color: "var(--gold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {files[s.key]!.name}</p>}
            {s.guide && <ImageGuideModal image={s.guide} align="right" />}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <button className="btn-gold" disabled={busy} onClick={submit} style={{ padding: "11px 40px", fontSize: 15 }}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>

      {log.length > 0 && (
        <div style={{ background: "rgba(7,13,26,.8)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, fontFamily: "monospace", fontSize: 12, marginTop: 16, wordBreak: "break-word" }}>
          {log.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("✓") || l.startsWith("↷") ? "var(--gold)" : l.startsWith("⚠") ? "#fbbf24" : "#f87171", marginBottom: 4 }}>{l}</div>
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
