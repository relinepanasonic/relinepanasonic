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

  const input =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Upload</h1>

      {/* Shared manual fields — same for the whole upload set */}
      <div className="grid grid-cols-2 gap-4 rounded-xl bg-white p-5 shadow-sm md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-gray-600">Client ID (superadmin)</span>
          <input className={input} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="leave blank if scoped" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-gray-600">Admin</span>
          <input className={input} value={manual.admin} onChange={(e) => setField("admin", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-gray-600">Bulan</span>
          <select className={input} value={manual.bulan} onChange={(e) => setField("bulan", e.target.value)}>
            {MONTHS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-gray-600">Year</span>
          <input type="number" className={input} value={manual.year} onChange={(e) => setField("year", Number(e.target.value))} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-gray-600">Week</span>
          <input className={input} value={manual.week} onChange={(e) => setField("week", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-gray-600">City</span>
          <input className={input} value={manual.city} onChange={(e) => setField("city", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-gray-600">PIC</span>
          <input className={input} value={manual.pic_client} onChange={(e) => setField("pic_client", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-gray-600">Store Name</span>
          <input className={input} value={manual.store_name} onChange={(e) => setField("store_name", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-gray-600">Tanggal Mulai</span>
          <input type="date" className={input} value={manual.tanggal_mulai} onChange={(e) => setField("tanggal_mulai", e.target.value)} />
        </label>
      </div>

      {/* 3 file slots */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {SLOTS.map((s) => (
          <div key={s.source} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="mb-2 font-medium">{s.label}</div>
            <input
              type="file"
              accept={s.accept}
              onChange={(e) =>
                setFiles((f) => ({ ...f, [s.source]: e.target.files?.[0] ?? null }))
              }
              className="text-sm"
            />
            {files[s.source] && (
              <p className="mt-2 truncate text-xs text-gray-500">{files[s.source]!.name}</p>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={submit}
        disabled={busy}
        className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Upload"}
      </button>

      {log.length > 0 && (
        <div className="rounded-xl bg-gray-900 p-4 font-mono text-xs text-gray-100">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
