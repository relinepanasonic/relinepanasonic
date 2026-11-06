// The result of ONE price check (Price Guard): one row per product, one column per checked store connection, each cell with the competitor's price
// next to our price. Shared by the screen, the XLS and the PDF so all three say the same thing.
export type ScrapeConn = { id: string; name?: string | null; store_name: string | null; platform: string | null; srp_no: string | null };
export type Cell = {
  ours: number | null; has_link: boolean; link_id: string | null; ok: boolean | null; error: string | null; price: number | null;
  original: number | null; discount_pct: number | null; labels: string[] | null; scraped_at: string | null;
};
export type ResultRow = { prod_id: string; product_name: string; cells: Record<string, Cell> };
export type ResultData = { columns: ScrapeConn[]; rows: ResultRow[] };
export type ResultMeta = { title: string; by: string | null; status: string };

// cheaper = the competitor sells below our price (red); pricier = above it (green)
export type Verdict = "cheaper" | "pricier" | "same" | "failed" | "pending" | "none";

export function diffPct(price: number, ours: number | null): number | null {
  return ours ? (price / ours - 1) * 100 : null;
}
export function verdict(cell?: Cell): Verdict {
  if (!cell || !cell.has_link) return "none";
  if (cell.ok === false) return "failed";
  if (cell.ok == null || cell.price == null) return "pending";
  const d = diffPct(cell.price, cell.ours);
  if (d == null || Math.abs(d) < 0.05) return "same";
  return d < 0 ? "cheaper" : "pricier";
}
// a connection is shown by its name, or by its store when it has none
export const colLabel = (c: ScrapeConn) => c.name || c.store_name || "—";
// the header of a column: just the connection name; the platform is added only when two columns would otherwise read the same
export function colLabels(columns: ScrapeConn[]): Map<string, string> {
  const base = columns.map(colLabel);
  const dup = new Set(base.filter((x, i) => base.indexOf(x) !== i));
  return new Map(columns.map((c, i) => [c.id, dup.has(base[i]) && c.platform ? `${base[i]} · ${c.platform}` : base[i]]));
}
export const colTitle = (c: ScrapeConn) => `${colLabel(c)}${c.platform ? ` · ${c.platform}` : ""}`;

// our price of a product: one value, or one per platform when the scraped connections are for different platforms and our prices differ
export function oursOf(row: ResultRow, columns: ScrapeConn[]): { platform: string | null; v: number }[] {
  const all = columns.map((c) => ({ platform: c.platform, v: row.cells[c.id]?.ours ?? null })).filter((x): x is { platform: string | null; v: number } => x.v != null);
  return [...new Map(all.map((x) => [x.v, x])).values()];
}
const rp = (n: number | null | undefined) => (n == null ? "" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const VERDICT_TEXT: Record<Verdict, string> = { cheaper: "Cheaper than us", pricier: "More expensive than us", same: "Same", failed: "Failed", pending: "No price yet", none: "Not sold" };

// one line per product x store (the second sheet of the XLS)
export function flatRows(data: ResultData) {
  const out: (string | number)[][] = [];
  for (const r of data.rows) {
    for (const c of data.columns) {
      const cell = r.cells[c.id];
      if (!cell?.has_link) continue;
      const v = verdict(cell);
      const d = cell.price != null ? diffPct(cell.price, cell.ours) : null;
      out.push([r.prod_id, r.product_name, c.srp_no || "", c.name || "", c.store_name || "", c.platform || "", cell.ours ?? "", cell.price ?? "", cell.original ?? "",
        cell.discount_pct ?? "", d == null ? "" : Math.round(d * 10) / 10, VERDICT_TEXT[v], (cell.labels || []).join(", "), cell.error || ""]);
    }
  }
  return out;
}
export const FLAT_HEAD = ["Prod ID", "Product Name", "SRP ID", "Connection", "Store", "Platform", "Our Price", "Competitor Price", "Before discount", "Discount %", "vs our price %", "Result", "Promo labels", "Error"];

export async function downloadScrapeXls(data: ResultData, meta: ResultMeta, fileStamp: string) {
  const XLSX = await import("xlsx");
  const head: string[] = ["Prod ID", "Product Name", "Our Price"];
  const labels = colLabels(data.columns);
  for (const c of data.columns) head.push(labels.get(c.id)!, `${labels.get(c.id)} vs our price %`);
  const body = data.rows.map((r) => {
    const ours = oursOf(r, data.columns);
    const line: (string | number)[] = [r.prod_id, r.product_name, ours.length === 1 ? ours[0].v : ours.map((x) => `${x.platform || ""} ${rp(x.v)}`.trim()).join(" / ")];
    for (const c of data.columns) {
      const cell = r.cells[c.id], v = verdict(cell);
      if (v === "none") { line.push("", ""); continue; }
      if (v === "failed") { line.push("failed", ""); continue; }
      if (v === "pending") { line.push("no price yet", ""); continue; }
      const d = diffPct(cell!.price!, cell!.ours);
      line.push(cell!.price!, d == null ? "" : Math.round(d * 10) / 10);
    }
    return line;
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
  ws["!cols"] = head.map((h, i) => ({ wch: i === 1 ? 46 : Math.max(14, Math.min(26, h.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, ws, "Result");
  const flat = XLSX.utils.aoa_to_sheet([FLAT_HEAD, ...flatRows(data)]);
  flat["!cols"] = FLAT_HEAD.map((h, i) => ({ wch: i === 1 ? 46 : Math.max(12, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, flat, "Detail");
  const info = XLSX.utils.aoa_to_sheet([["Prof Toko Online"], ["Price Guard Project"], [meta.title], ["Price Research by", meta.by || ""], ["Status", meta.status], ["Tokens used", `${data.columns.length} (1 token = 1 connection)`], [""],
    ["How to read", "A price below our price means the competitor is cheaper than us; above it, more expensive. The % is the difference with our price."]]);
  info["!cols"] = [{ wch: 18 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, info, "Info");
  XLSX.writeFile(wb, `price-guard-${fileStamp}.xlsx`);
}
