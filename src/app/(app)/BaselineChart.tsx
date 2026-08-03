"use client";

// "Baseline (Month Awal) vs Active" comparison — shows whether the team's
// intervention actually moved the needle vs the pre-project snapshot.
// Loaded via next/dynamic from page.tsx, same lazy-chunk treatment as the
// other recharts-backed components in DashboardCharts.tsx.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList } from "recharts";

type Side = { stores?: number; store_months?: number; sales: number; ad_cost: number };
type BaselineVsActive = {
  baseline: Side;
  active: Side;
  // Added by Supabase Migration/34 — same figures without the Panasonic
  // brand filter. Older RPC versions omit them, hence optional.
  baseline_all?: Side;
  active_all?: Side;
  partial_months_excluded?: number;
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

export default function BaselineChart({ data, scopeLabel }: { data: BaselineVsActive | null; scopeLabel: string }) {
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

  // Every month this scope has is still the newest (in-progress) one — so
  // there's nothing complete to average. Say so rather than drawing zero
  // bars, which would read as "no sales".
  if (months === 0) {
    return (
      <div className="panel">
        <h3 style={{ margin: "0 0 2px" }}>Baseline vs Active Performance — <span style={{ color: GOLD }}>{scopeLabel}</span></h3>
        <div className="hint">
          No completed month yet for {scopeLabel}. Data is uploaded weekly, and a month only counts once the next
          month starts arriving — so the comparison appears after the first full month is behind you.
        </div>
      </div>
    );
  }

  const row = (label: string, hintSuffix: string, m: ReturnType<typeof per>) => (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <MiniBarPanel
        title={`${label} Avg Monthly Sales`}
        hint={`${hintSuffix} · SPOS · per store / month`}
        formatter={idr}
        points={[
          { name: "Baseline", value: m.baseSales, color: BASELINE_COLOR },
          { name: "Active",   value: m.actSales,  color: ACTIVE_COLOR },
        ]}
      />
      <MiniBarPanel
        title={`${label} Avg Ads Spend`}
        hint={`${hintSuffix} · Ads · per store / month`}
        formatter={idr}
        points={[
          { name: "Baseline", value: m.baseAds, color: BASELINE_COLOR },
          { name: "Active",   value: m.actAds,  color: ACTIVE_COLOR },
        ]}
      />
      <MiniBarPanel
        title={`${label} Avg ROAS`}
        hint="Sales ÷ Ad Spend"
        formatter={(n) => n.toFixed(1) + "×"}
        points={[
          { name: "Baseline", value: m.baseRoas ?? 0, color: BASELINE_COLOR },
          { name: "Active",   value: m.actRoas ?? 0,  color: ACTIVE_COLOR },
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
        Pre-project snapshot (&quot;Month Awal&quot;, {stores} store{stores === 1 ? "" : "s"}) vs average per completed month
        ({months} store-month{months === 1 ? "" : "s"}).
        {data.partial_months_excluded ? (
          <> Data is uploaded weekly, so each store&apos;s newest month is still being filled in — {data.partial_months_excluded} in-progress
          month{data.partial_months_excluded === 1 ? " is" : "s are"} excluded so a part-month can&apos;t drag the average down.</>
        ) : null}
      </div>

      {row("Panasonic", "Panasonic", pana)}

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
