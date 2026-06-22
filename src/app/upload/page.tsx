"use client";

import { useState } from "react";
import type { DataSource } from "@/lib/parse";

const SLOTS: { source: DataSource; label: string; accept: string }[] = [
  { source: "perf", label: "Performa", accept: ".xlsx,.xls,.csv" },
  { source: "spos", label: "SPOS", accept: ".xlsx,.xls,.csv" },
  { source: "ads", label: "Ads", accept: ".xlsx,.xls,.csv" },
];

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

interface Props {
  // injected by the server wrapper below
}

export default function UploadPage() {
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [manual, setManual] = useState({
    admin: "",
    bulan: "Juni",
    year: new Date().getFullYear(),
    city: "",
    pic_client: "",
    store_name: "",
    week: "W1",
    tanggal_mulai: "",
  });
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  function setField<K extends keyof typeof manual>(k: K, v: (typeof manual)[K]) {
    setManual((m) => ({ ...m, [k]: v }));
  }

  async function submit() {
    setBusy(true);
    setLog([]);
    const chosen = SLOTS.filter((s) => files[s.source]);
    if (!chosen.length) {
      setLog(["Pick at least one file."]);
      setBusy(false);
      return;
    }
    for (const slot of chosen) {
      const fd = new FormData();
      fd.append("file", files[slot.source]!);
      fd.append("source", slot.source);
      fd.append("manual", JSON.stringify(manual));
      if (clientId) fd.append("client_id", clientId);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const j = await res.json();
        setLog((l) => [
          ...l,
          res.ok
            ? `✓ ${slot.label}: ${j.rows} rows`
            : `✗ ${slot.label}: ${j.error}`,
        ]);
      } catch (e) {
        setLog((l) => [...l, `✗ ${slot.label}: ${String(e)}`]);
      }
    }
    setBusy(false);
  }

  const inp: React.CSSProperties = {
    width: "100%", borderRadius: 8, padding: "8px 12px", fontSize: 13,
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
    color: "#e8edf8", outline: "none",
  };
  const label: React.CSSProperties = { fontSize: 11, color: "#7b8db0", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #0a1628 0%, #0f2040 100%)" }}>
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-bold" style={{ color: "#e8edf8" }}>Upload Data</h1>
        <p className="text-xs mt-0.5" style={{ color: "#7b8db0" }}>Upload Performa, SPOS, and Ads files for the same period</p>
      </div>

      {/* Shared manual fields */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3" style={{ background: "rgba(15,32,64,0.7)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20 }}>
        <div className="space-y-1">
          <span style={label}>Client ID (superadmin)</span>
          <input style={inp} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="leave blank if scoped" />
        </div>
        <div className="space-y-1">
          <span style={label}>Admin</span>
          <input style={inp} value={manual.admin} onChange={(e) => setField("admin", e.target.value)} />
        </div>
        <div className="space-y-1">
          <span style={label}>Bulan</span>
          <select style={inp} value={manual.bulan} onChange={(e) => setField("bulan", e.target.value)}>
            {MONTHS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <span style={label}>Year</span>
          <input type="number" style={inp} value={manual.year} onChange={(e) => setField("year", Number(e.target.value))} />
        </div>
        <div className="space-y-1">
          <span style={label}>Week</span>
          <input style={inp} value={manual.week} onChange={(e) => setField("week", e.target.value)} />
        </div>
        <div className="space-y-1">
          <span style={label}>City</span>
          <input style={inp} value={manual.city} onChange={(e) => setField("city", e.target.value)} />
        </div>
        <div className="space-y-1">
          <span style={label}>PIC</span>
          <input style={inp} value={manual.pic_client} onChange={(e) => setField("pic_client", e.target.value)} />
        </div>
        <div className="space-y-1">
          <span style={label}>Store Name</span>
          <input style={inp} value={manual.store_name} onChange={(e) => setField("store_name", e.target.value)} />
        </div>
        <div className="space-y-1">
          <span style={label}>Tanggal Mulai</span>
          <input type="date" style={inp} value={manual.tanggal_mulai} onChange={(e) => setField("tanggal_mulai", e.target.value)} />
        </div>
      </div>

      {/* 3 file slots */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {SLOTS.map((s) => (
          <div key={s.source} style={{ background: "rgba(15,32,64,0.7)", border: `1px solid ${files[s.source] ? "rgba(201,162,39,0.3)" : "rgba(255,255,255,0.06)"}`, borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#c9a227", marginBottom: 12 }}>{s.label}</div>
            <input
              type="file"
              accept={s.accept}
              onChange={(e) => setFiles((f) => ({ ...f, [s.source]: e.target.files?.[0] ?? null }))}
              style={{ fontSize: 12, color: "#94a3b8", width: "100%" }}
            />
            {files[s.source] && (
              <p style={{ marginTop: 8, fontSize: 11, color: "#c9a227", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ✓ {files[s.source]!.name}
              </p>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={submit}
        disabled={busy}
        style={{
          background: busy ? "rgba(201,162,39,0.4)" : "linear-gradient(135deg, #c9a227, #e8c84a)",
          color: "#0a1628", border: "none", borderRadius: 8,
          padding: "10px 28px", fontSize: 13, fontWeight: 700,
          cursor: busy ? "not-allowed" : "pointer",
          boxShadow: busy ? "none" : "0 4px 20px rgba(201,162,39,0.3)",
        }}
      >
        {busy ? "Uploading…" : "Upload Files"}
      </button>

      {log.length > 0 && (
        <div style={{ background: "rgba(10,22,40,0.8)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 16, fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>
          {log.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("✓") ? "#c9a227" : "#f87171", marginBottom: 4 }}>{l}</div>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
