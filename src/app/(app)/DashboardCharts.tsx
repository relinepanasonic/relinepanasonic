"use client";

// All recharts-backed chart components live here, split out of page.tsx so
// the ~390 KB recharts bundle is lazy-loaded (via next/dynamic in page.tsx)
// AFTER the dashboard's filters + KPI cards paint, instead of blocking the
// initial render of the app's most-visited page.

import { useEffect, useRef, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, LineChart, PieChart, Pie, Cell, Legend,
} from "recharts";

const PALETTE = ["#c9a227", "#e8c84a", "#94a3b8", "#1e4a7a", "#3b6ea5", "#d4b94e", "#6b8cae", "#0f2040"];

// Kept local to this module (rather than imported from page.tsx) so the lazy
// chunk stays self-contained — same small-formatter duplication pattern the
// codebase already uses (see reportPdf.tsx).
const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 2 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));

const tooltip = { background: "#0f2040", border: "1px solid rgba(201,162,39,.3)", borderRadius: 8, color: "#e8edf8", fontSize: 12 };
const axis = { fontSize: 10, fill: "#94a3b8" };

function Empty() { return <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>No data yet</div>; }

// Gives bars a glossy top-to-bottom gradient + soft drop shadow — a cheap
// "3D" look without a real perspective transform (which would break
// ResponsiveContainer's auto-sizing and tooltip hit-testing).
function BarDefs({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor={color} stopOpacity={1} />
        <stop offset="55%"  stopColor={color} stopOpacity={0.88} />
        <stop offset="100%" stopColor={color} stopOpacity={0.55} />
      </linearGradient>
      <filter id={`${id}-shadow`} x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor={color} floodOpacity="0.4" />
      </filter>
    </defs>
  );
}

export function BarsChart({ data, x, y, color }: { data: Record<string, unknown>[]; x: string; y: string; color: string }) {
  if (!data.length) return <Empty />;
  const gid = `barGrad-${y}`;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 40 }}>
          <BarDefs id={gid} color={color} />
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey={x} tick={axis} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={52} />
          <Tooltip contentStyle={tooltip} formatter={(v) => [idr(Number(v)), "Sales"]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
          <Bar dataKey={y} fill={`url(#${gid})`} style={{ filter: `url(#${gid}-shadow)` }} radius={[6, 6, 2, 2]} maxBarSize={46} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Product names are long ("AC Panasonic 1/2 PK Standart CS/CU-ZN5YKP..."), so
// the label gutter takes half the width and each label wraps onto up to two
// lines — recharts truncates a single-line tick, it never wraps on its own.
function WrappedTick({ x, y, payload, width }: {
  x?: number; y?: number; payload?: { value?: string }; width?: number;
}) {
  const gutter = width ?? 150;
  const full = String(payload?.value ?? "");
  // ~5.35px per char at 10px in this font — enough to pick a wrap point
  // without measuring text for every tick on every re-render.
  const perLine = Math.max(8, Math.floor((gutter - 12) / 5.35));
  const lines: string[] = [];
  let rest = full;
  while (rest.length > perLine && lines.length < 2) {
    const cut = rest.lastIndexOf(" ", perLine);
    const at = cut > perLine * 0.55 ? cut : perLine; // avoid a stubby first line
    lines.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (lines.length < 2) lines.push(rest);
  else if (rest) lines[1] = lines[1].slice(0, Math.max(0, perLine - 1)).trim() + "…";

  return (
    <g transform={`translate(${x},${y})`}>
      {lines.filter(Boolean).map((ln, i) => (
        <text key={i} x={-6} y={lines.length > 1 ? i * 11 - 4 : 0} dy={4}
          textAnchor="end" fill="#bcd0ee" fontSize={10}>{ln}</text>
      ))}
    </g>
  );
}

export function HBarChart({ data }: { data: { name: string; sales: number }[] }) {
  const [gutter, setGutter] = useState(150);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Give the labels half the chart's width, tracked live so it stays half
  // when the panel is resized.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const apply = () => setGutter(Math.round(Math.min(Math.max(el.clientWidth * 0.5, 140), 460)));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gid = "barGrad-hbar";
  return (
    <div ref={boxRef} style={{ width: "100%", height: 320 }}>
      {!data.length ? <Empty /> : (
        <ResponsiveContainer>
          <BarChart layout="vertical" data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor="#c9a227" stopOpacity={0.7} />
                <stop offset="100%" stopColor="#e8c84a" stopOpacity={1} />
              </linearGradient>
              <filter id={`${gid}-shadow`} x="-40%" y="-60%" width="180%" height="220%">
                <feDropShadow dx="2" dy="0" stdDeviation="2.5" floodColor="#c9a227" floodOpacity="0.35" />
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" horizontal={false} />
            <XAxis type="number" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={gutter} axisLine={false} tickLine={false}
              interval={0} tick={<WrappedTick width={gutter} />} />
            <Tooltip contentStyle={tooltip} formatter={(v) => [idr(Number(v)), "Sales"]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
            <Bar dataKey="sales" fill={`url(#${gid})`} style={{ filter: `url(#${gid}-shadow)` }} radius={[2, 6, 6, 2]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function Donut({ data, colors }: { data: { name: string; value: number }[]; colors?: string[] }) {
  const filtered = data.filter((x) => x.value > 0);
  if (!filtered.length) return <Empty />;
  const palette = colors || PALETTE;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <PieChart>
          <defs>
            {palette.map((c, i) => (
              <radialGradient key={i} id={`donutGrad-${i}`} cx="35%" cy="35%" r="75%">
                <stop offset="0%"   stopColor={c} stopOpacity={1} />
                <stop offset="100%" stopColor={c} stopOpacity={0.72} />
              </radialGradient>
            ))}
            <filter id="donut-shadow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.35" />
            </filter>
          </defs>
          <Pie data={filtered} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90}
               paddingAngle={2} style={{ filter: "url(#donut-shadow)" }}>
            {filtered.map((_, i) => <Cell key={i} fill={`url(#donutGrad-${i % palette.length})`} stroke="#0a1628" strokeWidth={2} />)}
          </Pie>
          <Tooltip contentStyle={tooltip} formatter={(v) => idr(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#bcd0ee" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CostRoas({ data }: { data: { label: string; cost: number; roas: number | null }[] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 40 }}>
          <BarDefs id="costRoasBar" color="#1e4a7a" />
          <defs>
            <filter id="roasLine-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#c9a227" floodOpacity="0.6" />
            </filter>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey="label" tick={axis} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={52} />
          <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={32} />
          <Tooltip contentStyle={tooltip} formatter={(v, n) => n === "roas" ? [(Number(v) || 0).toFixed(2) + "×", "ROAS"] : [idr(Number(v)), "Cost"]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
          <Bar yAxisId="l" dataKey="cost" fill="url(#costRoasBar)" style={{ filter: "url(#costRoasBar-shadow)" }} radius={[6, 6, 2, 2]} maxBarSize={40} />
          <Line yAxisId="r" type="monotone" dataKey="roas" stroke="#c9a227" strokeWidth={2.5}
                dot={{ r: 3.5, fill: "#c9a227", stroke: "#0a1628", strokeWidth: 1 }}
                style={{ filter: "url(#roasLine-glow)" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrafficTrend({ data }: { data: { label: string; traffic: number; in_cart: number }[] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey="label" tick={axis} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => num(Number(v))} axisLine={false} tickLine={false} width={48} />
          <Tooltip contentStyle={tooltip} formatter={(v, n) => [num(Number(v)), n === "in_cart" ? "In-Cart" : "Traffic"]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="traffic" stroke="#94a3b8" strokeWidth={2.5} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="in_cart" stroke="#c9a227" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Hand-drawn SVG trapezoid funnel — no recharts primitive for this shape.
// Shape only borrowed as a reference from another project's funnel (a
// wide-to-narrow stack of trapezoids with a % label per stage); colors and
// data are this app's own, not a copy of that project's chart.
const FUNNEL_STAGES: { key: "impression" | "click" | "in_cart" | "sales"; label: string }[] = [
  { key: "impression", label: "Impression" },
  { key: "click",      label: "Click" },
  { key: "in_cart",    label: "In Cart" },
  { key: "sales",      label: "Sales" },
];
const FUNNEL_COLORS = ["#3b6ea5", "#2f5a8a", "#24476e", "#c9a227"]; // last stage gold, matches the app's accent

function StageList({ values }: { values: number[] }) {
  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      {FUNNEL_STAGES.map((s, i) => (
        <div key={s.key}>
          <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{s.label}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: values[i] ? "#e8edf8" : "var(--muted)" }}>{num(values[i])}</div>
        </div>
      ))}
    </div>
  );
}

export function ProductFunnel({ data }: { data?: { impression: number; click: number; in_cart: number; sales: number } }) {
  const values = FUNNEL_STAGES.map((s) => (data ? data[s.key] || 0 : 0));
  if (!data || values.every((v) => !v)) return <Empty />;

  // A funnel is only a funnel if the TOP stage has data. Impression/Click
  // are newer columns (Supabase Migration/40) than the rest, so a period
  // can legitimately have In Cart / Sales while Impression is still 0 —
  // and drawing that produces a bow-tie (a 0-width stage between two wide
  // ones renders as two opposing triangles), which reads as a real shape
  // but means nothing. Show the numbers plainly instead, and say why.
  const partial = values[0] <= 0 || values.some((v) => v <= 0);
  if (partial) {
    return (
      <div style={{ width: "100%", height: 280, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
        <StageList values={values} />
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 10 }}>
          Funnel shape hidden — some stages have no data yet, so the proportions would be meaningless.
          Impression &amp; Click are read from the newer SPOS template columns
          (<em>Jumlah Produk Dilihat</em> / <em>Produk Diklik</em>); they fill in as SPOS files are re-uploaded.
        </div>
      </div>
    );
  }

  const top = values[0];
  // Guarantee the shape never widens going down, even if the data isn't
  // perfectly monotonic — a widening "funnel" would misrepresent the flow.
  // MIN_FRAC keeps a genuinely tiny last stage visible rather than a sliver.
  const MIN_FRAC = 0.12;
  const fracs: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const raw = Math.max(values[i] / top, MIN_FRAC);
    fracs.push(i === 0 ? raw : Math.min(raw, fracs[i - 1]));
  }

  const W = 380, ROW_H = 56, GAP = 4, PAD_TOP = 6;
  const H = FUNNEL_STAGES.length * (ROW_H + GAP) - GAP + PAD_TOP;
  const cx = W / 2;

  return (
    <div style={{ width: "100%", height: 280, display: "flex", gap: 18, alignItems: "center" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flexShrink: 0 }}>
        {FUNNEL_STAGES.map((s, i) => {
          const y = PAD_TOP + i * (ROW_H + GAP);
          const wTop = fracs[i] * (W - 20);
          const wBot = (i < fracs.length - 1 ? fracs[i + 1] : fracs[i] * 0.82) * (W - 20);
          const xTopL = cx - wTop / 2, xTopR = cx + wTop / 2;
          const xBotL = cx - wBot / 2, xBotR = cx + wBot / 2;
          // % of the TOP stage — the standard funnel read ("what fraction of
          // impressions reached this step"), not % of the previous step.
          const pct = (values[i] / top) * 100;
          return (
            <g key={s.key}>
              <polygon
                points={`${xTopL},${y} ${xTopR},${y} ${xBotR},${y + ROW_H} ${xBotL},${y + ROW_H}`}
                fill={FUNNEL_COLORS[i]} stroke="#0a1628" strokeWidth={1.5}
              />
              <text x={cx} y={y + ROW_H / 2 + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#fff">
                {pct < 0.1 && pct > 0 ? pct.toFixed(2) : pct.toFixed(1)}%
              </text>
            </g>
          );
        })}
      </svg>
      <StageList values={values} />
    </div>
  );
}
