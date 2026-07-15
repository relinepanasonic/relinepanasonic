"use client";

// New "Campaign Performance" table — one row per Ads campaign (Nama Iklan),
// flat (not grouped by product like the existing Grup Iklan drill-down).
// Sourced from the new campaign_performance() RPC (Supabase Migration/
// 28-campaign-performance.sql).
import { useEffect, useState, useMemo } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type CampaignRow = {
  campaign: string; store_name: string | null; city: string | null;
  views: number; clicks: number; add_to_cart: number;
  cost: number; sales: number; roas: number | null;
};
type SortKey = "campaign" | "store_name" | "views" | "clicks" | "add_to_cart" | "cost" | "sales" | "roas";
type SortDir = "asc" | "desc";

const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 2 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));

// green >5x, yellow 2-5x, red <2x — matches the color bands used for ROAS
// pills elsewhere in the app (dashboard's per-dealer table uses the same
// >=3/>=1 split; this table uses the thresholds explicitly requested here).
function roasColor(roas: number | null): string {
  if (!roas) return "var(--muted)";
  if (roas > 5) return "#4ade80";
  if (roas >= 2) return "#fbbf24";
  return "#f87171";
}

export default function CampaignPerformanceTable({ store, year, month, week }: {
  store?: string; year?: number | string; month?: string; week?: string;
}) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const { data, error: err } = await supabase.rpc("campaign_performance", {
        p_store: store || null,
        p_year:  year ? Number(year) : null,
        p_month: month || null,
        p_week:  week || null,
      });
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows((data as CampaignRow[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, store, year, month, week]);

  function toggleSort(key: SortKey) {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: "desc" };
      if (s.dir === "desc") return { key, dir: "asc" };
      return null;
    });
  }
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    const sign = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === "string" || typeof bv === "string") {
        return sign * String(av ?? "").localeCompare(String(bv ?? ""));
      }
      return sign * ((Number(av) || 0) - (Number(bv) || 0));
    });
  }, [rows, sort]);

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h3 style={{ margin: 0 }}>Campaign Performance</h3>
      <div className="hint">Per-campaign (Nama Iklan) totals for the selected period · click a column to sort</div>

      {error && (
        <div style={{ padding: 12, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 10, fontSize: 12, color: "#fca5a5", marginTop: 12, fontFamily: "monospace" }}>
          ⚠ {error}
        </div>
      )}

      <div className="tbl-wrap" style={{ marginTop: 14, maxHeight: 440 }}>
        <table className="tbl">
          <thead>
            <tr>
              <Th label="Campaign" sortKey="campaign" sort={sort} onSort={toggleSort} align="left" />
              <Th label="Dealer" sortKey="store_name" sort={sort} onSort={toggleSort} align="left" />
              <Th label="Views" sortKey="views" sort={sort} onSort={toggleSort} />
              <Th label="Clicks" sortKey="clicks" sort={sort} onSort={toggleSort} />
              <Th label="Add to Cart" sortKey="add_to_cart" sort={sort} onSort={toggleSort} />
              <Th label="Cost" sortKey="cost" sort={sort} onSort={toggleSort} />
              <Th label="Sales" sortKey="sales" sort={sort} onSort={toggleSort} />
              <Th label="ROAS" sortKey="roas" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r, i) => (
              <tr key={`${r.campaign}|${r.store_name}|${i}`}>
                <td>{r.campaign}</td>
                <td>{r.store_name || "—"}</td>
                <td className="num">{num(r.views)}</td>
                <td className="num">{num(r.clicks)}</td>
                <td className="num">{num(r.add_to_cart)}</td>
                <td className="num">{idr(r.cost)}</td>
                <td className="num">{idr(r.sales)}</td>
                <td className="num" style={{ color: roasColor(r.roas), fontWeight: 700 }}>
                  {r.roas ? r.roas.toFixed(1) + "x" : "—"}
                </td>
              </tr>
            ))}
            {!loading && sortedRows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                {error ? "Error — see message above." : "No campaign data for this period."}
              </td></tr>
            )}
            {loading && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ label, sortKey, sort, onSort, align = "right" }: {
  label: string; sortKey: SortKey; sort: { key: SortKey; dir: SortDir } | null;
  onSort: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = sort?.key === sortKey;
  const Icon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={align === "right" ? "num" : undefined} style={{ cursor: "pointer", userSelect: "none" }} onClick={() => onSort(sortKey)}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: align === "right" ? "flex-end" : "flex-start", width: "100%" }}>
        {align === "left" && <Icon size={12} style={{ opacity: active ? 1 : 0.4, flexShrink: 0 }} />}
        {label}
        {align === "right" && <Icon size={12} style={{ opacity: active ? 1 : 0.4, flexShrink: 0 }} />}
      </span>
    </th>
  );
}
