// Executive summary + analytics of ONE Price Research (Price Guard result). Pure functions, used by the PDF.
import { categoryRank, colLabels, diffPct, verdict, type ResultData, type ResultRow, type Verdict } from "./scrapeResult";

// a product type from its name (AC, TV, Washing Machine ...): the catalog has no category, and the marketplace categories differ per platform
const TYPES: [string, RegExp][] = [
  ["AC", /\bac\b|air conditioner|\bpk\b/i],
  ["TV", /\btv\b|televisi|\bled\b/i],
  ["Washing Machine", /mesin cuci|washing/i],
  ["Refrigerator", /kulkas|refrigerator|freezer/i],
  ["Fan", /kipas|\bfan\b|ventilat|exhaust/i],
  ["Water Heater", /water heater|pemanas air/i],
  ["Water Dispenser", /dispenser/i],
  ["Microwave & Oven", /microwave|oven/i],
  ["Kitchen", /rice cooker|blender|juicer|air fryer|mixer|kompor|cooker|toaster|kettle/i],
  ["Hair & Beauty", /hair|rambut|shaver|cukur|beauty|trimmer/i],
  ["Cleaning", /vacuum|penyedot|setrika|iron/i],
];
// the category of the SRP price list (RAC, REF ...) when the product has one, else a guess from its name
export const typeOf = (r: Pick<ResultRow, "product_name" | "category">) => r.category || productType(r.product_name);
export function productType(name: string): string {
  for (const [t, re] of TYPES) if (re.test(name)) return t;
  return "Other";
}

export type StoreStat = { id: string; label: string; platform: string | null; sold: number; compared: number; cheaper: number; pricier: number; same: number; broken: number; noPrice: number;
  avgDown: number | null; avgAll: number | null; coverage: number };
export type ProductGap = { prod_id: string; product_name: string; type: string; ours: number; price: number; store: string; pct: number; rp: number };
// our SRP against the market of ONE product: the average and the lowest competitor price
export type MarketGap = { prod_id: string; product_name: string; type: string; ours: number; avg: number; low: number; lowStore: string; pct: number; rp: number };
export type TypeStat = { type: string; products: number; compared: number; cheaper: number; worst: ProductGap | null; avgChange: number | null };
export type Summary = {
  tokens: number; products: number; links: number; compared: number; cheaper: number; pricier: number; same: number; notSold: number; broken: number; noPrice: number; pending: number;
  avgDown: number | null; avgAll: number | null; stores: StoreStat[]; dumping: StoreStat | null; types: TypeStat[]; changes: ProductGap[]; market: MarketGap[]; needChange: number; avgChange: number | null;
  insights: string[];
};

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const f1 = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

export function summarize(data: ResultData): Summary {
  const labels = colLabels(data.columns);
  const count: Record<Verdict, number> = { cheaper: 0, pricier: 0, same: 0, broken: 0, noprice: 0, pending: 0, none: 0 };
  const per = new Map(data.columns.map((c) => [c.id, { downs: [] as number[], all: [] as number[], s: { id: c.id, label: labels.get(c.id)!, platform: c.platform, sold: 0, compared: 0, cheaper: 0, pricier: 0, same: 0, broken: 0, noPrice: 0, avgDown: null as number | null, avgAll: null as number | null, coverage: 0 } }]));
  const gaps: ProductGap[] = [];
  const market: MarketGap[] = [];
  const allDown: number[] = [], all: number[] = [];

  for (const r of data.rows) {
    let best: ProductGap | null = null;
    const priced: { price: number; ours: number; store: string }[] = [];
    for (const c of data.columns) {
      const cell = r.cells[c.id], v = verdict(cell), p = per.get(c.id)!;
      count[v]++;
      if (v !== "none") p.s.sold++;
      if (v === "broken") p.s.broken++;
      if (v === "noprice") p.s.noPrice++;
      if (v !== "cheaper" && v !== "pricier" && v !== "same") continue;
      const d = diffPct(cell!.price!, cell!.ours);
      if (d == null) continue;
      p.s.compared++; p.all.push(d); all.push(d);
      if (cell!.ours != null) priced.push({ price: cell!.price!, ours: cell!.ours, store: labels.get(c.id)! });
      if (v === "cheaper") { p.s.cheaper++; p.downs.push(d); allDown.push(d); } else if (v === "pricier") p.s.pricier++; else p.s.same++;
      if (v === "cheaper" && (!best || d < best.pct)) best = { prod_id: r.prod_id, product_name: r.product_name, type: typeOf(r), ours: cell!.ours!, price: cell!.price!, store: labels.get(c.id)!, pct: d, rp: cell!.price! - cell!.ours! };
    }
    if (best) gaps.push(best);
    if (priced.length) {
      const avgP = priced.reduce((a, x) => a + x.price, 0) / priced.length, ours = priced.reduce((a, x) => a + x.ours, 0) / priced.length;
      const low = priced.reduce((a, x) => (x.price < a.price ? x : a));
      if (avgP < ours) market.push({ prod_id: r.prod_id, product_name: r.product_name, type: typeOf(r), ours, avg: avgP, low: low.price, lowStore: low.store, pct: (avgP / ours - 1) * 100, rp: avgP - ours });
    }
  }

  const stores = [...per.values()].map(({ s, downs, all: a }) => ({ ...s, avgDown: avg(downs), avgAll: avg(a), coverage: data.rows.length ? s.sold / data.rows.length : 0 }));
  // the most dumping store: the lowest average price below ours (needs at least one cheaper product)
  const ranked = stores.filter((s) => s.cheaper > 0).sort((a, b) => (a.avgDown! - b.avgDown!) || (b.cheaper - a.cheaper));
  stores.sort((a, b) => (a.avgDown ?? 1e9) - (b.avgDown ?? 1e9));

  const byType = new Map<string, TypeStat>();
  for (const r of data.rows) {
    const t = typeOf(r);
    if (!byType.has(t)) byType.set(t, { type: t, products: 0, compared: 0, cheaper: 0, worst: null, avgChange: null });
    const ts = byType.get(t)!; ts.products++;
    for (const c of data.columns) { const v = verdict(r.cells[c.id]); if (v === "cheaper" || v === "pricier" || v === "same") ts.compared++; if (v === "cheaper") ts.cheaper++; }
  }
  for (const [t, ts] of byType) {
    const g = gaps.filter((x) => x.type === t).sort((a, b) => a.pct - b.pct);
    ts.worst = g[0] || null; ts.avgChange = avg(g.map((x) => x.pct));
  }
  const types = [...byType.values()].sort((a, b) => categoryRank(a.type) - categoryRank(b.type) || a.type.localeCompare(b.type));
  const changes = [...gaps].sort((a, b) => a.pct - b.pct);
  market.sort((a, b) => a.pct - b.pct);

  const compared = count.cheaper + count.pricier + count.same;
  const sum: Summary = {
    tokens: data.columns.length, products: data.rows.length, links: compared + count.broken + count.noprice + count.pending, compared, cheaper: count.cheaper, pricier: count.pricier, same: count.same,
    notSold: count.none, broken: count.broken, noPrice: count.noprice, pending: count.pending, avgDown: avg(allDown), avgAll: avg(all), stores, dumping: ranked[0] || null, types, changes, market,
    needChange: market.length, avgChange: avg(market.map((x) => x.pct)), insights: [],
  };
  sum.insights = insights(sum);
  return sum;
}

function insights(s: Summary): string[] {
  const out: string[] = [];
  if (s.compared === 0) return ["No competitor price has been found yet, so there is nothing to compare."];
  const share = (s.cheaper / s.compared) * 100;
  out.push(`${s.cheaper} of ${s.compared} compared prices (${share.toFixed(0)}%) are below our price${s.avgDown != null ? `, on average ${f1(s.avgDown)}` : ""}.`);
  if (s.dumping) out.push(`${s.dumping.label}${s.dumping.platform ? ` (${s.dumping.platform})` : ""} undercuts us the most: ${f1(s.dumping.avgDown!)} on average over ${s.dumping.cheaper} product${s.dumping.cheaper > 1 ? "s" : ""}.`);
  if (s.changes[0]) out.push(`Biggest gap: ${s.changes[0].product_name} at ${f1(s.changes[0].pct)} (${s.changes[0].store}).`);
  if (s.pricier > 0) out.push(`${s.pricier} price${s.pricier > 1 ? "s are" : " is"} above ours: there is room to keep our price there.`);
  const wt = s.types.find((t) => t.worst);
  if (wt) out.push(`The most exposed product type is ${wt.type} (${wt.cheaper} of ${wt.compared} prices below ours).`);
  const weak = s.stores.filter((x) => x.coverage < 0.5);
  if (weak.length) out.push(`${weak.length} connection${weak.length > 1 ? "s sell" : " sells"} fewer than half of our products (${weak.map((x) => x.label).join(", ")}), so the comparison there is partial.`);
  if (s.broken > 0) out.push(`${s.broken} broken link${s.broken > 1 ? "s" : ""}: they do not lead to a product page, fix them in Prod Connect.`);
  if (s.noPrice > 0) out.push(`${s.noPrice} product${s.noPrice > 1 ? "s" : ""} with no price found (sold out, hidden or blocked): run the Price Research again later.`);
  return out;
}
