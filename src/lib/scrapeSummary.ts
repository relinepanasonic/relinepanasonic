// Executive summary + analytics of ONE Price Research (Price Guard result). Pure functions, used by the PDF.
import { colLabels, diffPct, verdict, type ResultData, type Verdict } from "./scrapeResult";

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
export function productType(name: string): string {
  for (const [t, re] of TYPES) if (re.test(name)) return t;
  return "Other";
}

export type StoreStat = { id: string; label: string; platform: string | null; sold: number; compared: number; cheaper: number; pricier: number; same: number; failed: number;
  avgDown: number | null; avgAll: number | null; coverage: number };
export type ProductGap = { prod_id: string; product_name: string; type: string; ours: number; price: number; store: string; pct: number; rp: number };
export type TypeStat = { type: string; products: number; compared: number; cheaper: number; worst: ProductGap | null; avgChange: number | null };
export type Summary = {
  tokens: number; products: number; links: number; compared: number; cheaper: number; pricier: number; same: number; notSold: number; failed: number; pending: number;
  avgDown: number | null; avgAll: number | null; stores: StoreStat[]; dumping: StoreStat | null; types: TypeStat[]; changes: ProductGap[]; needChange: number; avgChange: number | null;
  insights: string[];
};

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const f1 = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

export function summarize(data: ResultData): Summary {
  const labels = colLabels(data.columns);
  const count: Record<Verdict, number> = { cheaper: 0, pricier: 0, same: 0, failed: 0, pending: 0, none: 0 };
  const per = new Map(data.columns.map((c) => [c.id, { downs: [] as number[], all: [] as number[], s: { id: c.id, label: labels.get(c.id)!, platform: c.platform, sold: 0, compared: 0, cheaper: 0, pricier: 0, same: 0, failed: 0, avgDown: null as number | null, avgAll: null as number | null, coverage: 0 } }]));
  const gaps: ProductGap[] = [];
  const allDown: number[] = [], all: number[] = [];

  for (const r of data.rows) {
    let best: ProductGap | null = null;
    for (const c of data.columns) {
      const cell = r.cells[c.id], v = verdict(cell), p = per.get(c.id)!;
      count[v]++;
      if (v !== "none") p.s.sold++;
      if (v === "failed") p.s.failed++;
      if (v !== "cheaper" && v !== "pricier" && v !== "same") continue;
      const d = diffPct(cell!.price!, cell!.ours);
      if (d == null) continue;
      p.s.compared++; p.all.push(d); all.push(d);
      if (v === "cheaper") { p.s.cheaper++; p.downs.push(d); allDown.push(d); } else if (v === "pricier") p.s.pricier++; else p.s.same++;
      if (v === "cheaper" && (!best || d < best.pct)) best = { prod_id: r.prod_id, product_name: r.product_name, type: productType(r.product_name), ours: cell!.ours!, price: cell!.price!, store: labels.get(c.id)!, pct: d, rp: cell!.price! - cell!.ours! };
    }
    if (best) gaps.push(best);
  }

  const stores = [...per.values()].map(({ s, downs, all: a }) => ({ ...s, avgDown: avg(downs), avgAll: avg(a), coverage: data.rows.length ? s.sold / data.rows.length : 0 }));
  // the most dumping store: the lowest average price below ours (needs at least one cheaper product)
  const ranked = stores.filter((s) => s.cheaper > 0).sort((a, b) => (a.avgDown! - b.avgDown!) || (b.cheaper - a.cheaper));
  stores.sort((a, b) => (a.avgDown ?? 1e9) - (b.avgDown ?? 1e9));

  const byType = new Map<string, TypeStat>();
  for (const r of data.rows) {
    const t = productType(r.product_name);
    if (!byType.has(t)) byType.set(t, { type: t, products: 0, compared: 0, cheaper: 0, worst: null, avgChange: null });
    const ts = byType.get(t)!; ts.products++;
    for (const c of data.columns) { const v = verdict(r.cells[c.id]); if (v === "cheaper" || v === "pricier" || v === "same") ts.compared++; if (v === "cheaper") ts.cheaper++; }
  }
  for (const [t, ts] of byType) {
    const g = gaps.filter((x) => x.type === t).sort((a, b) => a.pct - b.pct);
    ts.worst = g[0] || null; ts.avgChange = avg(g.map((x) => x.pct));
  }
  const types = [...byType.values()].sort((a, b) => (a.worst?.pct ?? 1) - (b.worst?.pct ?? 1));
  const changes = [...gaps].sort((a, b) => a.pct - b.pct);

  const compared = count.cheaper + count.pricier + count.same;
  const sum: Summary = {
    tokens: data.columns.length, products: data.rows.length, links: compared + count.failed + count.pending, compared, cheaper: count.cheaper, pricier: count.pricier, same: count.same,
    notSold: count.none, failed: count.failed, pending: count.pending, avgDown: avg(allDown), avgAll: avg(all), stores, dumping: ranked[0] || null, types, changes,
    needChange: changes.length, avgChange: avg(changes.map((x) => x.pct)), insights: [],
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
  if (s.failed > 0) out.push(`${s.failed} link${s.failed > 1 ? "s" : ""} could not be read; run the Price Research again for them.`);
  return out;
}
