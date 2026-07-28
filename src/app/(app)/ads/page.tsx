"use client";

import Link from "next/link";
import nextDynamic from "next/dynamic";

export const dynamic = "force-dynamic";

// Lazy-load the recharts-backed Ads Overview so recharts stays out of this
// page's initial bundle (same pattern as the main dashboard's charts).
const AdsOverview = nextDynamic(() => import("./AdsOverview"), {
  ssr: false,
  loading: () => <div className="ske" style={{ width: "100%", height: 320, borderRadius: 8, marginTop: 18 }} />,
});

export default function AdsPage() {
  return (
    <>
      <style>{`
        .mode-tab{padding:7px 16px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
        .mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
      `}</style>

      {/* ── Sub-page tabs ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <span className="mode-tab on">Performance</span>
        <Link href="/ads/formulation" className="mode-tab">Formulation</Link>
      </div>

      {/* ── Ads Overview (7-KPI grid, category cards, funnel, group + product tables) ── */}
      <AdsOverview />
    </>
  );
}
