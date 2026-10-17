"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Date range field like Shopee Seller Centre: one box ("01/09 - 30/09"), a pop-up with quick ranges on the left and two
// months side by side. Click a start day and an end day, or press on a day and drag to the other end.
// Values are ISO dates "yyyy-mm-dd"; "" = no limit on that side.
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const DOW = ["M", "S", "S", "R", "K", "J", "S"]; // Senin .. Minggu
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const short = (s: string) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "");

export default function DateRangePicker({ from, to, onChange, placeholder = "All dates" }: {
  from: string; to: string; onChange: (from: string, to: string) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => { const d = from ? fromIso(from) : new Date(); return new Date(d.getFullYear(), d.getMonth() - (from ? 0 : 1), 1); });
  const [anchor, setAnchor] = useState<string | null>(null);   // first day picked, waiting for the second
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const today = iso(new Date());

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setAnchor(null); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // the range drawn on the calendar: the saved one, or the one being picked
  const [rs, re] = useMemo(() => {
    if (anchor) { const b = hover || anchor; return anchor <= b ? [anchor, b] : [b, anchor]; }
    return [from, to];
  }, [anchor, hover, from, to]);

  function finish(a: string, b: string) {
    const [s, e] = a <= b ? [a, b] : [b, a];
    onChange(s, e); setAnchor(null); setHover(null); setDragging(false); setOpen(false);
  }
  function down(d: string) {
    if (anchor) { finish(anchor, d); return; }
    setAnchor(d); setHover(d); setDragging(true);
  }
  function up(d: string) {
    if (dragging && anchor && d !== anchor) finish(anchor, d);   // dragged to another day
    else setDragging(false);                                     // a click: wait for the second click
  }
  function preset(days: number | "yesterday" | "today") {
    const t = new Date();
    if (days === "today") return finish(iso(t), iso(t));
    if (days === "yesterday") { const y = iso(addDays(t, -1)); return finish(y, y); }
    finish(iso(addDays(t, -(days - 1))), iso(t));
  }

  const month = (first: Date) => {
    const lead = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(new Date(first.getFullYear(), first.getMonth(), i + 1)))];
    while (cells.length % 7) cells.push(null);
    return (
      <div style={{ width: 252 }}>
        <div style={{ textAlign: "center", fontWeight: 700, color: "#fff", marginBottom: 8 }}>{MONTHS[first.getMonth()]} {first.getFullYear()}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 36px)", rowGap: 4 }}>
          {DOW.map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 11.5, color: "var(--muted)", padding: "4px 0" }}>{d}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const inRange = rs && re && d >= rs && d <= re;
            const edge = d === rs || d === re;
            return (
              <div key={i} onMouseDown={(e) => { e.preventDefault(); down(d); }} onMouseEnter={() => anchor && setHover(d)} onMouseUp={() => up(d)}
                style={{
                  textAlign: "center", padding: "6px 0", fontSize: 13, cursor: "pointer", userSelect: "none",
                  background: edge ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : inRange ? "rgba(201,162,39,.18)" : "transparent",
                  color: edge ? "var(--navy-deep)" : d === today ? "var(--gold)" : "#e8edf8", fontWeight: edge || d === today ? 700 : 400,
                  borderRadius: edge ? 6 : 0,
                }}>{Number(d.slice(8))}</div>
            );
          })}
        </div>
      </div>
    );
  };
  const next = new Date(view.getFullYear(), view.getMonth() + 1, 1);
  const nav = (n: number) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));
  const navBtn: React.CSSProperties = { background: "none", border: "none", color: "#cdd9f0", cursor: "pointer", fontSize: 15, padding: "2px 6px" };

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 190, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
          border: "1px solid rgba(201,162,39,.25)", background: "rgba(10,22,40,.6)", color: from || to ? "#fff" : "var(--muted)", fontSize: 13.5 }}>
        <span>📅</span>
        <span style={{ flex: 1, textAlign: "left" }}>{from || to ? `${short(from) || "…"} - ${short(to) || "…"}${from && to && from.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${from.slice(0, 4)}` : ""}` : placeholder}</span>
        {(from || to) && <span onClick={(e) => { e.stopPropagation(); onChange("", ""); }} title="Clear" style={{ color: "var(--muted)" }}>✕</span>}
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 60, top: "calc(100% + 6px)", left: 0, display: "flex", background: "var(--card,#0d1a36)",
          border: "1px solid rgba(201,162,39,.3)", borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,.6)" }}
          onMouseLeave={() => dragging && setDragging(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "12px 8px", borderRight: "1px solid var(--line)", minWidth: 150 }}>
            {([["Hari Ini", "today"], ["Kemarin", "yesterday"], ["1 Minggu Terakhir", 7], ["1 Bulan Terakhir", 30], ["3 Bulan Terakhir", 90]] as const).map(([l, v]) => (
              <button key={l} type="button" onClick={() => preset(v)} style={{ textAlign: "left", background: "none", border: "none", color: "#e8edf8", cursor: "pointer", padding: "7px 10px", borderRadius: 6, fontSize: 13 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,39,.12)")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>{l}</button>
            ))}
            <button type="button" onClick={() => { onChange("", ""); setOpen(false); setAnchor(null); }} style={{ textAlign: "left", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "7px 10px", fontSize: 13 }}>Semua tanggal</button>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span><button type="button" style={navBtn} onClick={() => nav(-12)}>«</button><button type="button" style={navBtn} onClick={() => nav(-1)}>‹</button></span>
              <span><button type="button" style={navBtn} onClick={() => nav(1)}>›</button><button type="button" style={navBtn} onClick={() => nav(12)}>»</button></span>
            </div>
            <div style={{ display: "flex", gap: 22 }}>{month(view)}{month(next)}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>{anchor ? "Now click (or release on) the last day" : "Click the first and the last day, or drag across the days"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
