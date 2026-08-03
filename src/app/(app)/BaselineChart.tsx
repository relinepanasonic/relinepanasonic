"use client";

// "Baseline (Month Awal) vs Active" comparison — shows whether the team's
// intervention actually moved the needle vs the pre-project snapshot.
// Loaded via next/dynamic from page.tsx, same lazy-chunk treatment as the
// other recharts-backed components in DashboardCharts.tsx.
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList,
  ComposedChart, Line, PieChart, Pie,
} from "recharts";

type Side = { stores?: number; store_months?: number; sales: number; ad_cost: number };
type BaselineVsActive = {
  baseline: Side;
  active: Side;
  // Added by Supabase Migration/34 — same figures without the Panasonic
  // brand filter. Older RPC versions omit them, hence optional.
  baseline_all?: Side;
  active_all?: Side;
  partial_months_excluded?: number;
  // Added by Supabase Migration/36 — true when the dashboard's Month filter
  // is set, meaning `active` is that ONE month's real figures, not an
  // average. Older RPC versions omit it (treated as false: average mode).
  is_month_filtered?: boolean;
};

const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 2 }).format(n || 0);
const idrFull = (n: number) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const tooltip = { background: "#0f2040", border: "1px solid rgba(201,162,39,.3)", borderRadius: 8, color: "#e8edf8", fontSize: 12 };
const axis = { fontSize: 10, fill: "#94a3b8" };
const GOLD = "#c9a227";
const BASELINE_COLOR = "#94a3b8"; // grey — "before"
const ACTIVE_COLOR = GOLD;        // "after", matches the app's accent

function MiniBarPanel({ title, hint, points, formatter }: {
  title: string; hint: string;
  points: { name: string; value: number; color: string }[];
  formatter: (n: number) => string;
}) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 0 }}>
      <h3 style={{ margin: "0 0 2px" }}>{title}</h3>
      <div className="hint" style={{ marginBottom: 14 }}>{hint}</div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={points} margin={{ left: 4, right: 8, top: 20, bottom: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
            <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} tickFormatter={(v) => formatter(Number(v))} axisLine={false} tickLine={false} width={56} />
            {/* Bold gold label text so the hovered bar's category (Baseline/Active) is legible against the dark tooltip */}
            <Tooltip contentStyle={tooltip} labelStyle={{ color: GOLD, fontWeight: 700 }} formatter={(v) => [formatter(Number(v)), ""]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
            {/* The Y axis auto-rescales to each render's own data, so bar HEIGHTS
                look similar across different filter selections even when the
                underlying numbers differ — printing the value on top of every
                bar makes a filter change visible without comparing axis ticks. */}
            <Bar dataKey="value" radius={[6, 6, 2, 2]} maxBarSize={70}>
              {points.map((p, i) => <Cell key={i} fill={p.color} />)}
              {/* `fill` as a direct prop, not style={{fill:...}} — recharts' Text
                  component defaults to a dark fill and doesn't reliably pick up
                  color from a style object, which is why this rendered black. */}
              <LabelList dataKey="value" position="top" formatter={(v: unknown) => formatter(Number(v))} fill="#ffffff" fontSize={10.5} fontWeight={700} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Ads Spend (bars) + ROAS (line, secondary axis) in one chart — same
// technique as DashboardCharts.tsx's CostRoas, adapted for two categorical
// points (Baseline/Active) instead of a time series.
function AdsRoasCombo({ title, hint, points }: {
  title: string; hint: string;
  points: { name: string; spend: number; roas: number | null; color: string }[];
}) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 0 }}>
      <h3 style={{ margin: "0 0 2px" }}>{title}</h3>
      <div className="hint" style={{ marginBottom: 14 }}>{hint}</div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <ComposedChart data={points} margin={{ left: 4, right: 8, top: 20, bottom: 6 }}>
            <defs>
              <filter id="baseline-roasLine-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor={GOLD} floodOpacity="0.6" />
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
            <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={56} />
            <YAxis yAxisId="r" orientation="right" tick={axis} tickFormatter={(v) => Number(v).toFixed(0) + "×"} axisLine={false} tickLine={false} width={40} />
            <Tooltip contentStyle={tooltip} labelStyle={{ color: GOLD, fontWeight: 700 }}
              formatter={(v, n) => n === "roas" ? [(Number(v) || 0).toFixed(1) + "×", "ROAS"] : [idr(Number(v)), "Ads Spend"]}
              cursor={{ fill: "rgba(201,162,39,.05)" }} />
            <Bar yAxisId="l" dataKey="spend" radius={[6, 6, 2, 2]} maxBarSize={70}>
              {points.map((p, i) => <Cell key={i} fill={p.color} />)}
              <LabelList dataKey="spend" position="top" formatter={(v: unknown) => idr(Number(v))} fill="#ffffff" fontSize={10.5} fontWeight={700} />
            </Bar>
            <Line yAxisId="r" type="monotone" dataKey="roas" stroke={GOLD} strokeWidth={2.5}
              dot={{ r: 4, fill: GOLD, stroke: "#0a1628", strokeWidth: 1 }}
              style={{ filter: "url(#baseline-roasLine-glow)" }}
              label={{ position: "top", fill: GOLD, fontSize: 10.5, fontWeight: 700, offset: 12,
                formatter: (v: unknown) => v == null ? "" : Number(v).toFixed(1) + "×" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Two donuts side by side — Panasonic's share of total store GMV, before vs
// after. "Other" is whatever the store sold that ISN'T Panasonic, derived
// from the Panasonic and All-Brand figures already computed above (same
// per-store-average basis on both sides, so the ratio is unaffected by the
// averaging — a share is scale-invariant).
function ShareDonut({ label, pana, all, color }: { label: string; pana: number; all: number; color: string }) {
  const other = Math.max(all - pana, 0);
  const total = pana + other;
  const points = [{ name: "Panasonic", value: pana }, { name: "Other Brands", value: other }];
  const pct = total > 0 ? (pana / total) * 100 : 0;
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#e8edf8", marginBottom: 6 }}>{label}</div>
      <div style={{ width: "100%", height: 190, position: "relative" }}>
        {total > 0 ? (
          <ResponsiveContainer>
            <PieChart>
              <Pie data={points} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={2}>
                <Cell fill={color} stroke="#0a1628" strokeWidth={2} />
                <Cell fill="#2a3a5c" stroke="#0a1628" strokeWidth={2} />
              </Pie>
              <Tooltip contentStyle={tooltip} formatter={(v) => idrFull(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)", fontSize: 12 }}>No data</div>
        )}
        {total > 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <span style={{ fontSize: 20, fontWeight: 800, color }}>{pct.toFixed(0)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BaselineChart({ data, scopeLabel, monthLabel }: { data: BaselineVsActive | null; scopeLabel: string; monthLabel: string | null }) {
  if (!data) {
    return (
      <div className="panel">
        <h3 style={{ margin: "0 0 2px" }}>Baseline vs Active Performance</h3>
        <div className="hint">Loading…</div>
      </div>
    );
  }

  const { baseline, active } = data;
  const stores = baseline.stores ?? 0;
  const months = active.store_months ?? 0;
  const hasBaseline = stores > 0;
  // Old RPCs (pre migration/36) don't send this flag; fall back to "average
  // mode" (false), which was the only mode that existed before.
  const monthFiltered = data.is_month_filtered ?? false;

  // Baseline is a one-off per-store snapshot; Active spans many store-months
  // — so both are normalised to a per-store-per-month basis before comparing.
  const per = (b: Side, a: Side) => ({
    baseSales: stores ? b.sales / stores : 0,
    actSales:  months ? a.sales / months : 0,
    baseAds:   stores ? b.ad_cost / stores : 0,
    actAds:    months ? a.ad_cost / months : 0,
    baseRoas:  b.ad_cost > 0 ? b.sales / b.ad_cost : null,
    actRoas:   a.ad_cost > 0 ? a.sales / a.ad_cost : null,
  });
  const pana = per(baseline, active);
  // Pre-migration-34 RPCs don't return the all-brand keys; hide that row
  // rather than plotting zeros that look like real "no sales" data.
  const allData = data.baseline_all && data.active_all ? per(data.baseline_all, data.active_all) : null;

  // Baseline ad spend is typically near-zero (pre-project, no ads program
  // yet) — dividing by a near-zero denominator produces an enormous, not
  // meaningful, ROAS figure. Flag it instead of silently plotting a
  // misleading number.
  const baselineAdsThin = hasBaseline && baseline.ad_cost < baseline.sales * 0.001;

  if (!hasBaseline) {
    return (
      <div className="panel">
        <h3 style={{ margin: "0 0 2px" }}>Baseline vs Active Performance — <span style={{ color: GOLD }}>{scopeLabel}</span></h3>
        <div className="hint">No &quot;Month Awal&quot; baseline data for {scopeLabel}.</div>
      </div>
    );
  }

  if (months === 0) {
    return (
      <div className="panel">
        <h3 style={{ margin: "0 0 2px" }}>Baseline vs Active Performance — <span style={{ color: GOLD }}>{scopeLabel}</span></h3>
        <div className="hint">
          {monthFiltered
            // A specific month was picked and this scope has no rows for it —
            // different from the "nothing complete yet" case below.
            ? <>No data for {monthLabel} yet for {scopeLabel}.</>
            // Every month this scope has is still the newest (in-progress)
            // one — nothing complete to average. Say so rather than drawing
            // zero bars, which would read as "no sales".
            : <>No completed month yet for {scopeLabel}. Data is uploaded weekly, and a month only counts once the next
              month starts arriving — so the comparison appears after the first full month is behind you.</>}
        </div>
      </div>
    );
  }

  // "Avg" only means something when Active is an average across several
  // store-months (the "All Months" default). With a specific month picked,
  // Active is that one month's real total, so the label says so instead —
  // e.g. "Panasonic Monthly Sales — Juli 2026", not "Avg Monthly Sales".
  const activeTag = monthFiltered ? `${monthLabel}` : `avg / store / month`;
  const row = (label: string, hintSuffix: string, m: ReturnType<typeof per>) => (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <MiniBarPanel
        title={monthFiltered ? `${label} Monthly Sales` : `${label} Avg Monthly Sales`}
        hint={`${hintSuffix} · SPOS · Active = ${activeTag}`}
        formatter={idr}
        points={[
          { name: "Baseline", value: m.baseSales, color: BASELINE_COLOR },
          { name: "Active",   value: m.actSales,  color: ACTIVE_COLOR },
        ]}
      />
      <AdsRoasCombo
        title={monthFiltered ? `${label} Ads Spend & ROAS` : `${label} Avg Ads Spend & ROAS`}
        hint={`${hintSuffix} · Ads · Active = ${activeTag}`}
        points={[
          { name: "Baseline", spend: m.baseAds, roas: m.baseRoas, color: BASELINE_COLOR },
          { name: "Active",   spend: m.actAds,  roas: m.actRoas,  color: ACTIVE_COLOR },
        ]}
      />
    </div>
  );

  return (
    <div className="panel">
      {/* Scope shown right in the title (gold) — changing City/Dealer changes
          this label immediately, which is the clearest proof the chart below
          is actually re-fetching for the new filter. */}
      <h3 style={{ margin: "0 0 2px" }}>Baseline vs Active Performance — <span style={{ color: GOLD }}>{scopeLabel}</span></h3>
      <div className="hint" style={{ marginBottom: 14 }}>
        {monthFiltered ? (
          <>Pre-project snapshot (&quot;Month Awal&quot;, {stores} store{stores === 1 ? "" : "s"}) vs <strong style={{ color: GOLD }}>{monthLabel}</strong>
          {" "}({months} store{months === 1 ? "" : "s"} with data that month).</>
        ) : (
          <>Pre-project snapshot (&quot;Month Awal&quot;, {stores} store{stores === 1 ? "" : "s"}) vs average per completed month
          ({months} store-month{months === 1 ? "" : "s"}).
          {data.partial_months_excluded ? (
            <> Data is uploaded weekly, so each store&apos;s newest month is still being filled in — {data.partial_months_excluded} in-progress
            month{data.partial_months_excluded === 1 ? " is" : "s are"} excluded so a part-month can&apos;t drag the average down.</>
          ) : null}</>
        )}
      </div>

      {row("Panasonic", "Panasonic", pana)}

      {/* Market share only makes sense for Panasonic vs everything else —
          "All Brand vs All Brand" would always be 100%, so this doesn't
          repeat for the All Brand row below. Needs both figures, so it's
          hidden (not zeroed) on pre-migration-34 RPCs same as the All Brand
          row itself. */}
      {allData && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3 style={{ margin: "0 0 2px" }}>Panasonic Market Share (Baseline vs Active)</h3>
          <div className="hint" style={{ marginBottom: 10 }}>Panasonic sales ÷ total store sales (all brands) · SPOS</div>
          <div style={{ display: "flex", gap: 16 }}>
            <ShareDonut label="Baseline" pana={pana.baseSales} all={allData.baseSales} color={GOLD} />
            <ShareDonut label={monthFiltered ? "Active" : "Active (avg)"} pana={pana.actSales} all={allData.actSales} color={GOLD} />
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: GOLD, display: "inline-block" }} />Panasonic</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: "#2a3a5c", display: "inline-block" }} />Other Brands</span>
          </div>
        </div>
      )}

      {allData && (
        <div style={{ marginTop: 16 }}>
          {row("All Brand", "Every brand in the store", allData)}
        </div>
      )}

      {baselineAdsThin && (
        <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 6 }}>
          <span>⚠</span>
          <span>
            Baseline ad spend is only {idrFull(baseline.ad_cost)} total (near zero — no ads program pre-project),
            so Baseline ROAS ({pana.baseRoas ? pana.baseRoas.toFixed(1) + "×" : "—"}) is a near-zero-denominator artifact,
            not a meaningful ratio to compare against Active ({pana.actRoas ? pana.actRoas.toFixed(1) + "×" : "—"}).
          </span>
        </div>
      )}
    </div>
  );
}
