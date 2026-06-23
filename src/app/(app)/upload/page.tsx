"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DataSource } from "@/lib/parse";

export const dynamic = "force-dynamic";

const SLOTS: { source: DataSource; label: string; hint: string; accept: string }[] = [
  { source: "perf", label: "Performa", hint: "sales_overview", accept: ".xlsx,.xls,.csv" },
  { source: "spos", label: "SPOS", hint: "parentskudetail", accept: ".xlsx,.xls,.csv" },
  { source: "ads", label: "Ads", hint: "Data Keseluruhan Iklan", accept: ".xlsx,.xls,.csv" },
];

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];

export default function UploadPage() {
  const [supabase] = useState(() => createClient());
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [manual, setManual] = useState({
    admin: "", bulan: "Juni", baseline_month: "", year: new Date().getFullYear(),
    city: "", pic_client: "", store_name: "", week: "Week 1", tanggal_mulai: "",
  });
  const [clientId, setClientId] = useState(""); // single default workspace

  // Core List–driven option lists
  const [admins, setAdmins] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [stores, setStores] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  function setField<K extends keyof typeof manual>(k: K, v: (typeof manual)[K]) {
    setManual((m) => ({ ...m, [k]: v }));
  }

  // Load the per-client lists (City / Owner / Store) from Core List.
  const reload = useCallback(async (cid: string) => {
    if (!cid) { setCities([]); setOwners([]); setStores([]); return; }
    const [{ data: md }, { data: sl }] = await Promise.all([
      supabase.from("master_data").select("value").eq("client_id", cid).eq("kind", "city").order("value"),
      supabase.from("store_links").select("owner,store_name").eq("client_id", cid).order("created_at"),
    ]);
    setCities(((md as { value: string }[]) || []).map((r) => r.value));
    const links = (sl as { owner: string | null; store_name: string | null }[]) || [];
    const uniq = (xs: (string | null)[]) => Array.from(new Set(xs.filter(Boolean) as string[])).sort();
    setOwners(uniq(links.map((l) => l.owner)));
    setStores(uniq(links.map((l) => l.store_name)));
  }, [supabase]);

  useEffect(() => {
    (async () => {
      // default workspace client + admin people (Admin dropdown)
      const [{ data: cs }, { data: ps }] = await Promise.all([
        supabase.from("clients").select("id").order("created_at").limit(1),
        supabase.from("profiles").select("display_name,email,role").in("role", ["superadmin", "client_admin"]),
      ]);
      const adminNames = ((ps as { display_name: string | null; email: string | null }[]) || [])
        .map((p) => p.display_name || p.email || "")
        .filter(Boolean);
      setAdmins(Array.from(new Set(adminNames)).sort());
      const first = (cs as { id: string }[])?.[0]?.id || "";
      setClientId(first);
      reload(first);
    })();
  }, [supabase, reload]);

  async function submit() {
    setBusy(true); setLog([]);
    if (!clientId) { setLog(["Pick a Client first."]); setBusy(false); return; }
    const chosen = SLOTS.filter((s) => files[s.source]);
    if (!chosen.length) { setLog(["Pick at least one file."]); setBusy(false); return; }
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
  }

  return (
    <>
      <div className="panel">
        <h3>Upload Shopee Data</h3>
        <div className="hint">Pick the week&apos;s details once, attach one or more exports (Performa / SPOS / Ads), then Upload. Brand &amp; Tipe Produk are auto-detected.</div>

        <div className="upl-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 16 }}>
          <Field label="Admin">
            <select value={manual.admin} onChange={(e) => setField("admin", e.target.value)}>
              <option value="">Select admin…</option>
              {admins.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Bulan (data month)">
            <select value={manual.bulan} onChange={(e) => setField("bulan", e.target.value)}>
              {MONTHS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>

          <Field label="Bulan Awal (Baseline)">
            <select value={manual.baseline_month} onChange={(e) => setField("baseline_month", e.target.value)}>
              <option value="">None</option>
              {MONTHS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Year"><input type="number" value={manual.year} onChange={(e) => setField("year", Number(e.target.value))} /></Field>
          <Field label="Week">
            <select value={manual.week} onChange={(e) => setField("week", e.target.value)}>
              {WEEKS.map((w) => <option key={w}>{w}</option>)}
            </select>
          </Field>

          <Field label="City">
            <select value={manual.city} onChange={(e) => setField("city", e.target.value)} disabled={!clientId}>
              <option value="">Select city…</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Owner">
            <select value={manual.pic_client} onChange={(e) => setField("pic_client", e.target.value)} disabled={!clientId}>
              <option value="">Select owner…</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Store Name">
            <select value={manual.store_name} onChange={(e) => setField("store_name", e.target.value)} disabled={!clientId}>
              <option value="">Select store…</option>
              {stores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          <Field label="Tanggal Mulai"><input type="date" value={manual.tanggal_mulai} onChange={(e) => setField("tanggal_mulai", e.target.value)} /></Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, margin: "20px 0 8px", padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)" }}>
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

        <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center", marginTop: 14 }}>
          <button className="btn-gold" disabled={busy} onClick={submit} style={{ padding: "11px 40px", fontSize: 15 }}>
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>

        {log.length > 0 && (
          <div style={{ background: "rgba(7,13,26,.8)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, fontFamily: "monospace", fontSize: 12, marginTop: 16 }}>
            {log.map((l, i) => <div key={i} style={{ color: l.startsWith("✓") ? "var(--gold)" : "#f87171", marginBottom: 4 }}>{l}</div>)}
          </div>
        )}
      </div>
    </>
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
