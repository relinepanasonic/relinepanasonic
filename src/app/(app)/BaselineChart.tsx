"use client";

// "Baseline (Month Awal) vs Active" comparison — shows whether the team's
// intervention actually moved the needle vs the pre-project snapshot.
// Loaded via next/dynamic from page.tsx, same lazy-chunk treatment as the
// other recharts-backed components in DashboardCharts.tsx.
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList,
  ComposedChart, Line, PieChart, Pie,
} from "recharts";
import { DASH_T, tf, type Lang } from "@/lib/dashLang";

type Side = { stores?: number; months?: number; sales: number; ad_cost: number };
type BaselineVsActive = {
  baseline: Side;
  active: Side;
  // Added by Supabase Migration/34 — same figures without the Panasonic
  // brand filter. Older RPC versions omit them, hence optional.
  baseline_all?: Side;
  active_all?: Side;
  // Added by Supabase Migration/36 — true when the dashboard's Month filter
  // is set, meaning `active` is that ONE month's real figures, not an
  // average. Older RPC versions omit it (treated as false: average mode).
  is_month_filtered?: boolean;
  // Added by Supabase Migration/38 — all-brand category mix, before/after.
  // Older RPC versions omit them; the Category Share card hides itself.
  baseline_categories?: { category: string; sales: number }[];
  active_categories?: { category: string; sales: number }[];
};

// Same family as the app's other multi-series palettes (DashboardCharts.tsx).
const CAT_PALETTE = ["#c9a227", "#e8c84a", "#94a3b8", "#1e4a7a", "#3b6ea5", "#d4b94e", "#6b8cae"];
const OTHERS_COLOR = "#3a4a6e";

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
    <div className="panel">
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
              <LabelList dataKey="value" position="top" formatter={(v: unknown) => formatter(Number(v))} fill="#94a3b8" fontSize={10.5} fontWeight={700} />
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
function AdsRoasCombo({ title, hint, points, lang = "id" }: {
  title: string; hint: string;
  points: { name: string; spend: number; roas: number | null; color: string }[];
  lang?: Lang;
}) {
  const t = DASH_T[lang];
  return (
    <div className="panel">
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
              formatter={(v, n) => n === "roas" ? [(Number(v) || 0).toFixed(1) + "×", t.c_roas] : [idr(Number(v)), t.c_adsSpend]}
              cursor={{ fill: "rgba(201,162,39,.05)" }} />
            <Bar yAxisId="l" dataKey="spend" radius={[6, 6, 2, 2]} maxBarSize={70}>
              {points.map((p, i) => <Cell key={i} fill={p.color} />)}
              <LabelList dataKey="spend" position="top" formatter={(v: unknown) => idr(Number(v))} fill="#94a3b8" fontSize={10.5} fontWeight={700} />
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
// basis on both sides, so the ratio is unaffected — a share is
// scale-invariant regardless of how the totals were averaged).
function ShareDonut({ label, pana, all, color, lang = "id" }: { label: string; pana: number; all: number; color: string; lang?: Lang }) {
  const t = DASH_T[lang];
  const other = Math.max(all - pana, 0);
  const total = pana + other;
  const points = [{ name: t.b_panasonic, value: pana }, { name: t.b_otherBrands, value: other }];
  const pct = total > 0 ? (pana / total) * 100 : 0;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "#e8edf8", marginBottom: 4 }}>{label}</div>
      <div style={{ width: "100%", height: 150, position: "relative" }}>
        {total > 0 ? (
          <ResponsiveContainer>
            <PieChart>
              <Pie data={points} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2}>
                <Cell fill={color} stroke="#0a1628" strokeWidth={2} />
                <Cell fill="#2a3a5c" stroke="#0a1628" strokeWidth={2} />
              </Pie>
              <Tooltip contentStyle={tooltip} formatter={(v) => idrFull(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)", fontSize: 12 }}>{DASH_T[lang].c_noData}</div>
        )}
        {total > 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <span style={{ fontSize: 16, fontWeight: 800, color }}>{pct.toFixed(0)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Same idea as ShareDonut but N slices instead of 2 (Panasonic/Other) — the
// category mix for one period. Colors are assigned by the CALLER from a
// combined baseline+active ranking, so the same category keeps the same
// color across both donuts (comparing two independently-ranked pies would
// let colors swap between periods, defeating the point of a before/after).
function CategoryDonut({ label, rows, lang = "id" }: { label: string; rows: { category: string; sales: number; color: string }[]; lang?: Lang }) {
  const total = rows.reduce((a, r) => a + r.sales, 0);
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "#e8edf8", marginBottom: 4 }}>{label}</div>
      <div style={{ width: "100%", height: 150 }}>
        {total > 0 ? (
          <ResponsiveContainer>
            <PieChart>
              <Pie data={rows} dataKey="sales" nameKey="category" cx="50%" cy="50%" innerRadius={30} outerRadius={62} paddingAngle={1.5}>
                {rows.map((r, i) => <Cell key={i} fill={r.color} stroke="#0a1628" strokeWidth={1.5} />)}
              </Pie>
              <Tooltip contentStyle={tooltip} formatter={(v, n) => [idrFull(Number(v)), n as string]} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)", fontSize: 12 }}>{DASH_T[lang].c_noData}</div>
        )}
      </div>
    </div>
  );
}

export default function BaselineChart({ data, scopeLabel, monthLabel, lang = "id" }: { data: BaselineVsActive | null; scopeLabel: string; monthLabel: string | null; lang?: Lang }) {
  const t = DASH_T[lang];
  if (!data) {
    return (
      <div className="panel">
        <h3 style={{ margin: "0 0 2px" }}>{t.b_title}</h3>
        <div className="hint">{t.b_loading}</div>
      </div>
    );
  }

  const { baseline, active } = data;
  const stores = baseline.stores ?? 0;
  const months = active.months ?? 0;
  const hasBaseline = stores > 0;
  // Old RPCs (pre migration/36) don't send this flag; fall back to "average
  // mode" (false), which was the only mode that existed before.
  const monthFiltered = data.is_month_filtered ?? false;

  // City-wide totals, NOT divided by store count (migration 37) — the
  // filter is City/Dealer, not "per dealer", so Baseline and Active are
  // each the scope's whole total. Active is still divided by the number
  // of MONTHS (not store-months) when averaging across "All Months".
  const per = (b: Side, a: Side) => ({
    baseSales: b.sales,
    actSales:  months ? a.sales / months : 0,
    baseAds:   b.ad_cost,
    actAds:    months ? a.ad_cost / months : 0,
    baseRoas:  b.ad_cost > 0 ? b.sales / b.ad_cost : null,
    actRoas:   a.ad_cost > 0 ? a.sales / a.ad_cost : null,
  });
  const pana = per(baseline, active);
  // Pre-migration-34 RPCs don't return the all-brand keys; hide that row
  // rather than plotting zeros that look like real "no sales" data.
  const allData = data.baseline_all && data.active_all ? per(data.baseline_all, data.active_all) : null;

  // Category color assignment: rank by COMBINED baseline+active sales (not
  // each period separately) so a category keeps the same color in both
  // donuts — independent per-period ranking would let colors swap between
  // "before" and "after", defeating a side-by-side comparison.
  const catRows = ((): { baseline: { category: string; sales: number; color: string }[]; active: { category: string; sales: number; color: string }[] } | null => {
    const b = data.baseline_categories, a = data.active_categories;
    if (!b || !a) return null; // pre-migration-38 RPC
    const combined = new Map<string, number>();
    for (const r of b) combined.set(r.category, (combined.get(r.category) || 0) + r.sales);
    for (const r of a) combined.set(r.category, (combined.get(r.category) || 0) + r.sales);
    const ranked = [...combined.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c);
    const top = new Set(ranked.slice(0, CAT_PALETTE.length));
    const colorOf = (c: string) => top.has(c) ? CAT_PALETTE[ranked.indexOf(c)] : OTHERS_COLOR;
    const bucket = (rows: { category: string; sales: number }[]) => {
      const out = new Map<string, number>();
      for (const r of rows) {
        const key = top.has(r.category) ? r.category : "Others";
        out.set(key, (out.get(key) || 0) + r.sales);
      }
      return [...out.entries()]
        .map(([category, sales]) => ({ category, sales, color: category === "Others" ? OTHERS_COLOR : colorOf(category) }))
        .sort((x, y) => y.sales - x.sales);
    };
    return { baseline: bucket(b), active: bucket(a) };
  })();

  // Baseline ad spend is typically near-zero (pre-project, no ads program
  // yet) — dividing by a near-zero denominator produces an enormous, not
  // meaningful, ROAS figure. Flag it instead of silently plotting a
  // misleading number.
  const baselineAdsThin = hasBaseline && baseline.ad_cost < baseline.sales * 0.001;

  if (!hasBaseline) {
    return (
      <div className="panel">
        <h3 style={{ margin: "0 0 2px" }}>{t.b_title} — <span style={{ color: GOLD }}>{scopeLabel}</span></h3>
        <div className="hint">{tf(t.b_noBaseline, { scope: scopeLabel })}</div>
      </div>
    );
  }

  if (months === 0) {
    return (
      <div className="panel">
        <h3 style={{ margin: "0 0 2px" }}>{t.b_title} — <span style={{ color: GOLD }}>{scopeLabel}</span></h3>
        <div className="hint">
          {monthFiltered ? tf(t.b_noDataMonth, { month: monthLabel || "", scope: scopeLabel }) : tf(t.b_noDataYear, { scope: scopeLabel })}
        </div>
      </div>
    );
  }

  // "Avg" only means something when Active is an average across several
  // months (the "All Months" default). With a specific month picked, Active
  // is that one month's real total, so the label says so instead — e.g.
  // "Panasonic Monthly Sales — Juli 2026", not "Avg Monthly Sales".
  const activeTag = monthFiltered ? `${monthLabel}` : t.b_avgPerMonth;
  const baselineLabel = t.b_baseline;
  const activeLabel = monthFiltered ? t.b_active : t.b_activeAvg;
  // Sales + Ads/ROAS + a caller-supplied third card, all in one row of 3.
  const row3 = (label: string, hintSuffix: string, m: ReturnType<typeof per>, extra: React.ReactNode) => (
    <div className="chart-row">
      <MiniBarPanel
        title={tf(monthFiltered ? t.b_monthlySalesTitle : t.b_avgMonthlySalesTitle, { label })}
        hint={tf(t.b_hintSuffixSales, { suffix: hintSuffix, tag: activeTag })}
        formatter={idr}
        points={[
          { name: baselineLabel, value: m.baseSales, color: BASELINE_COLOR },
          { name: activeLabel,   value: m.actSales,  color: ACTIVE_COLOR },
        ]}
      />
      <AdsRoasCombo
        title={tf(monthFiltered ? t.b_adsRoasTitle : t.b_avgAdsRoasTitle, { label })}
        hint={tf(t.b_hintSuffixAds, { suffix: hintSuffix, tag: activeTag })}
        points={[
          { name: baselineLabel, spend: m.baseAds, roas: m.baseRoas, color: BASELINE_COLOR },
          { name: activeLabel,   spend: m.actAds,  roas: m.actRoas,  color: ACTIVE_COLOR },
        ]}
        lang={lang}
      />
      {extra}
    </div>
  );

  const marketShareCard = allData && (
    <div className="panel">
      <h3 style={{ margin: "0 0 2px" }}>{t.b_marketShareTitle}</h3>
      <div className="hint" style={{ marginBottom: 6 }}>{t.b_marketShareHint}</div>
      <div className="donut-pair">
        <ShareDonut label={baselineLabel} pana={pana.baseSales} all={allData.baseSales} color={GOLD} lang={lang} />
        <ShareDonut label={activeLabel} pana={pana.actSales} all={allData.actSales} color={GOLD} lang={lang} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 2, fontSize: 10.5, color: "var(--muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: GOLD, display: "inline-block" }} />{t.b_panasonic}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#2a3a5c", display: "inline-block" }} />{t.b_otherBrands}</span>
      </div>
    </div>
  );

  const categoryShareCard = catRows && (
    <div className="panel">
      <h3 style={{ margin: "0 0 2px" }}>{t.b_categoryShareTitle}</h3>
      <div className="hint" style={{ marginBottom: 6 }}>{t.b_categoryShareHint}</div>
      <div className="donut-pair">
        <CategoryDonut label={baselineLabel} rows={catRows.baseline} lang={lang} />
        <CategoryDonut label={activeLabel} rows={catRows.active} lang={lang} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "3px 10px", marginTop: 4, fontSize: 9.5, color: "var(--muted)" }}>
        {/* Union of both periods' legend entries, same fixed color per category from the ranking above. */}
        {[...new Map([...catRows.baseline, ...catRows.active].map((r) => [r.category, r.color])).entries()].map(([cat, color]) => (
          <span key={cat} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: color, display: "inline-block" }} />{cat}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="panel">
      {/* Scope shown right in the title (gold) — changing City/Dealer changes
          this label immediately, which is the clearest proof the chart below
          is actually re-fetching for the new filter. */}
      <h3 style={{ margin: "0 0 2px" }}>{t.b_title} — <span style={{ color: GOLD }}>{scopeLabel}</span></h3>
      <div className="hint" style={{ marginBottom: 14 }}>
        {/* English is the only one of the three languages that pluralizes
            with a trailing "s" — Indonesian and Japanese nouns don't inflect,
            so the placeholder resolves to "" for those. */}
        {monthFiltered ? (
          tf(t.b_scopeMonthHint, { stores, storesPlural: lang === "en" && stores !== 1 ? "s" : "", month: monthLabel || "" })
        ) : (
          tf(t.b_scopeAvgHint, { stores, storesPlural: lang === "en" && stores !== 1 ? "s" : "", months, monthsPlural: lang === "en" && months !== 1 ? "s" : "" })
        )}
      </div>

      {/* Market share only makes sense for Panasonic vs everything else —
          "All Brand vs All Brand" would always be 100%, so it rides along
          in the Panasonic row instead of repeating in the All Brand row
          below. Hidden (not zeroed) on pre-migration-34 RPCs, same as the
          All Brand row itself. */}
      {row3(t.b_panasonic, t.b_panasonic, pana, marketShareCard)}

      {allData && (
        <div style={{ marginTop: 16 }}>
          {row3(t.b_allBrand, t.b_everyBrand, allData, categoryShareCard)}
        </div>
      )}

      {baselineAdsThin && (
        <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 6 }}>
          <span>⚠</span>
          <span>
            {tf(t.b_thinAdsWarning, {
              amount: idrFull(baseline.ad_cost),
              baseRoas: pana.baseRoas ? pana.baseRoas.toFixed(1) + "×" : "—",
              activeRoas: pana.actRoas ? pana.actRoas.toFixed(1) + "×" : "—",
            })}
          </span>
        </div>
      )}
    </div>
  );
}
