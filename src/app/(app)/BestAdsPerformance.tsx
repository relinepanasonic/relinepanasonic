"use client";

// Ranked-card "Best Ads Performance" widget for the main Dashboard — design
// adapted (not copied) from a reference screenshot the user supplied: a
// funnel-style leaderboard (Views -> Clicks% -> Cart%) ranked by Sales, with
// a proportional bar per row. Colors/typography follow this app's existing
// gold/navy palette rather than the reference's blue theme. Pure SVG/divs —
// no recharts, so no lazy-loading needed here.
import { Eye, MousePointerClick, ShoppingCart } from "lucide-react";

type CampaignRow = {
  campaign: string; store_name: string | null; city: string | null;
  views: number; clicks: number; add_to_cart: number;
  cost: number; sales: number; roas: number | null;
};

const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 2 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const pct = (n: number) => n.toFixed(1) + "%";

export default function BestAdsPerformance({ data, limit = 8 }: { data: CampaignRow[] | null; limit?: number }) {
  const rows = (data || []).slice(0, limit);
  const maxSales = rows[0]?.sales || 1;

  return (
    <div className="panel">
      <h3 style={{ margin: "0 0 2px" }}>Best Ads Performance</h3>
      <div className="hint" style={{ marginBottom: 14 }}>
        Top {limit} · Views → Clicks → Add to Cart · Panasonic Ads
      </div>

      {!data && <div style={{ color: "var(--muted)", fontSize: 13, padding: "12px 0" }}>Loading…</div>}
      {data && rows.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: "12px 0" }}>No Panasonic ads data for this filter.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 440, overflowY: "auto" }}>
        {rows.map((r, i) => {
          const ctr = r.views ? (r.clicks / r.views) * 100 : 0;
          const cartRate = r.clicks ? (r.add_to_cart / r.clicks) * 100 : 0;
          const barPct = r.sales > 0 ? Math.max((r.sales / maxSales) * 100, 3) : 0;
          return (
            <div key={`${r.campaign}|${r.store_name}|${i}`} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ color: "var(--gold)", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{
                    color: "#e8edf8", fontWeight: 600, fontSize: 13,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }} title={`${r.store_name ?? ""} · ${r.campaign}`}>
                    {r.store_name ? <span style={{ color: "#8fb4e0" }}>{r.store_name}</span> : null}
                    {r.store_name ? " · " : ""}{r.campaign}
                  </span>
                </div>
                <span style={{ color: "var(--gold)", fontWeight: 800, fontSize: 14, flexShrink: 0, whiteSpace: "nowrap" }}>{idr(r.sales)}</span>
              </div>

              <div style={barTrackStyle}>
                <div style={{ ...barFillStyle, width: `${barPct}%` }} />
              </div>

              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11.5, color: "var(--muted)", flexWrap: "wrap" }}>
                <span style={statStyle}><Eye size={13} style={{ opacity: 0.7 }} /> {num(r.views)} Views</span>
                <span style={statStyle}>
                  <MousePointerClick size={13} style={{ opacity: 0.7 }} /> {num(r.clicks)} Clicks <span style={{ color: "#8fb4e0" }}>({pct(ctr)})</span>
                </span>
                <span style={statStyle}>
                  <ShoppingCart size={13} style={{ opacity: 0.7 }} /> {num(r.add_to_cart)} Cart <span style={{ color: "#8fb4e0" }}>({pct(cartRate)})</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.15)", borderRadius: 12, padding: "12px 14px",
};
const barTrackStyle: React.CSSProperties = {
  height: 5, borderRadius: 3, background: "rgba(255,255,255,.06)", overflow: "hidden",
};
const barFillStyle: React.CSSProperties = {
  height: "100%", borderRadius: 3, background: "linear-gradient(90deg,#3b6ea5,#5a91cc)",
  boxShadow: "0 0 8px rgba(59,110,165,.5)", transition: "width .3s ease",
};
const statStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5 };
