"use client";

import { useEffect, useRef, useState } from "react";

// A dropdown where several options can be ticked. Nothing ticked = all.
export default function MultiSelect({ options, value, onChange, allLabel = "All", unit = "selected", minWidth = 200 }: {
  options: string[]; value: string[]; onChange: (v: string[]) => void; allLabel?: string; unit?: string; minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const label = value.length === 0 || value.length === options.length ? allLabel : value.length === 1 ? value[0] : `${value.length} ${unit}`;
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, minWidth, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
          border: "1px solid rgba(201,162,39,.25)", background: "rgba(10,22,40,.6)", color: "#fff", fontSize: 13.5 }}>
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ color: "var(--muted)", fontSize: 11 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 60, top: "calc(100% + 6px)", left: 0, minWidth: Math.max(minWidth, 240), maxHeight: 320, overflowY: "auto",
          background: "var(--card,#0d1a36)", border: "1px solid rgba(201,162,39,.3)", borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,.6)", padding: 8 }}>
          <div style={{ display: "flex", gap: 8, padding: "4px 6px 8px", borderBottom: "1px solid var(--line)", marginBottom: 6 }}>
            <button type="button" className="btn-ghost" onClick={() => onChange([...options])}>Select all</button>
            <button type="button" className="btn-ghost" onClick={() => onChange([])}>Clear</button>
          </div>
          {options.map((o) => (
            <label key={o} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#e8edf8" }}>
              <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} /> {o}
            </label>
          ))}
          {options.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12.5, padding: 8 }}>Nothing to choose</div>}
        </div>
      )}
    </div>
  );
}
