"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => THIS_YEAR - 4 + i);

type ReportType = "ceo" | "brand_manager" | "dealer_owner";
const REPORT_TYPES: { v: ReportType; label: string; hint: string }[] = [
  { v: "ceo",           label: "Panasonic CEO",     hint: "Company-wide performance across every city and dealer" },
  { v: "brand_manager", label: "Brand Manager",     hint: "Scoped to one city — all dealers within it" },
  { v: "dealer_owner",  label: "Dealer Owner",      hint: "Scoped to one dealer/store" },
];

type CityRow = { value: string };

export default function ReportsPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [cities, setCities] = useState<CityRow[]>([]);
  const [dealers, setDealers] = useState<string[]>([]);

  const [reportType, setReportType] = useState<ReportType>("ceo");
  const [city, setCity] = useState("");
  const [store, setStore] = useState("");
  const [year, setYear] = useState(THIS_YEAR);
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);
      const { data: cityRows } = await supabase.from("master_data").select("value").eq("kind", "city").eq("client_id", cid).order("value");
      setCities((cityRows as CityRow[]) || []);
    })();
  }, [supabase]);

  async function pickCity(v: string) {
    setCity(v);
    setStore("");
    if (!v || !clientId) { setDealers([]); return; }
    const { data } = await supabase.from("master_data").select("value").eq("kind", "store").eq("client_id", clientId).eq("city", v).order("value");
    setDealers(((data as { value: string }[]) || []).map((d) => d.value));
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ reportType, city: city || undefined, store: store || undefined, year, month }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Failed to generate report" }));
        setError(j.error || "Failed to generate report");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] || `report-${month}-${year}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  const canGenerate =
    (reportType === "ceo") ||
    (reportType === "brand_manager" && !!city) ||
    (reportType === "dealer_owner" && !!city && !!store);

  return (
    <div className="panel">
      <h3 style={{ margin: "0 0 4px" }}>Monthly Report</h3>
      <div className="hint" style={{ marginBottom: 18 }}>
        Generate a PDF performance report for a given month — company-wide (CEO), per city (Brand Manager), or per dealer (Dealer Owner).
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
        {REPORT_TYPES.map((t) => (
          <button
            key={t.v}
            onClick={() => { setReportType(t.v); setCity(""); setStore(""); }}
            style={{
              textAlign: "left", padding: 14, borderRadius: 12, cursor: "pointer",
              border: `1px solid ${reportType === t.v ? "var(--gold)" : "rgba(201,162,39,.2)"}`,
              background: reportType === t.v ? "rgba(201,162,39,.12)" : "rgba(10,22,40,.4)",
            }}
          >
            <div style={{ fontWeight: 700, color: reportType === t.v ? "var(--gold)" : "#e8edf8", fontSize: 14 }}>{t.label}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{t.hint}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        {(reportType === "brand_manager" || reportType === "dealer_owner") && (
          <Field label="City">
            <select value={city} onChange={(e) => pickCity(e.target.value)}>
              <option value="">Select city</option>
              {cities.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
            </select>
          </Field>
        )}
        {reportType === "dealer_owner" && (
          <Field label="Dealer">
            <select value={store} onChange={(e) => setStore(e.target.value)} disabled={!city}>
              <option value="">{city ? "Select dealer" : "Select city first"}</option>
              {dealers.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
        )}
        <Field label="Year">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="Month">
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>

      <button className="btn-gold" disabled={busy || !canGenerate} onClick={generate} style={{ padding: "11px 40px", fontSize: 14 }}>
        {busy ? "Generating…" : "Generate PDF"}
      </button>

      {error && (
        <div style={{ marginTop: 14, color: "#f87171", fontSize: 13 }}>{error}</div>
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
