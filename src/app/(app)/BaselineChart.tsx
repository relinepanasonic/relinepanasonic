"use client";

// "Baseline (Month Awal) vs Active" comparison — shows whether the team's
// intervention actually moved the needle vs the pre-project snapshot.
// Loaded via next/dynamic from page.tsx, same lazy-chunk treatment as the
// other recharts-backed components in DashboardCharts.tsx.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList } from "recharts";

type BaselineVsActive = {
  baseline: { stores: number; sales: number; ad_cost: number };
  active: { store_months: number; sales: number; ad_cost: number };
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
  const hasBaseline = baseline.stores > 0;
  const avgBaselineSales = hasBaseline ? baseline.sales / baseline.stores : 0;
  const avgActiveSales = active.store_months ? active.sales / active.store_months : 0;
  const avgBaselineAds = hasBaseline ? baseline.ad_cost / baseline.stores : 0;
  const avgActiveAds = active.store_months ? active.ad_cost / active.store_months : 0;
  const roasBaseline = baseline.ad_cost > 0 ? baseline.sales / baseline.ad_cost : null;
  const roasActive = active.ad_cost > 0 ? active.sales / active.ad_cost : null;

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

  return (
    <div className="panel">
      {/* Scope shown right in the title (gold) — changing City/Dealer changes
          this label immediately, which is the clearest proof the chart below
          is actually re-fetching for the new filter. */}
      <h3 style={{ margin: "0 0 2px" }}>Baseline vs Active Performance — <span style={{ color: GOLD }}>{scopeLabel}</span></h3>
      <div className="hint" style={{ marginBottom: 14 }}>
        Pre-project snapshot (&quot;Month Awal&quot;, {baseline.stores} store{baseline.stores === 1 ? "" : "s"}) vs average per active month
        ({active.store_months} store-month{active.store_months === 1 ? "" : "s"}) — Panasonic SPOS &amp; Ads only.
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <MiniBarPanel
          title="Avg Monthly Sales / Store"
          hint="Panasonic · SPOS"
          formatter={idr}
          points={[
            { name: "Baseline", value: avgBaselineSales, color: BASELINE_COLOR },
            { name: "Active",   value: avgActiveSales,   color: ACTIVE_COLOR },
          ]}
        />
        <MiniBarPanel
          title="Avg Ads Spend / Store"
          hint="Panasonic · Ads"
          formatter={idr}
          points={[
            { name: "Baseline", value: avgBaselineAds, color: BASELINE_COLOR },
            { name: "Active",   value: avgActiveAds,   color: ACTIVE_COLOR },
          ]}
        />
        <MiniBarPanel
          title="ROAS"
          hint="Sales ÷ Ad Spend"
          formatter={(n) => n.toFixed(1) + "×"}
          points={[
            { name: "Baseline", value: roasBaseline ?? 0, color: BASELINE_COLOR },
            { name: "Active",   value: roasActive ?? 0,   color: ACTIVE_COLOR },
          ]}
        />
      </div>
      {baselineAdsThin && (
        <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 6 }}>
          <span>⚠</span>
          <span>
            Baseline ad spend is only {idrFull(baseline.ad_cost)} total (near zero — no ads program pre-project),
            so Baseline ROAS ({roasBaseline ? roasBaseline.toFixed(1) + "×" : "—"}) is a near-zero-denominator artifact,
            not a meaningful ratio to compare against Active ({roasActive ? roasActive.toFixed(1) + "×" : "—"}).
          </span>
        </div>
      )}
    </div>
  );
}
