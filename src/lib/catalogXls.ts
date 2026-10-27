// XLS template / import of the Product Catalog (Price Calculator > Price Research > Product Catalog).
// One flat sheet, one row per product: No | SRP ID | Product Name | Prod ID | Price SRP. Prod ID is the key: a known Prod ID is updated
// (an SRP change is logged), a new one is added.

export const CATALOG_HEADER = ["No", "SRP ID", "Product Name", "Prod ID", "Price SRP"] as const;
export const CATALOG_EXAMPLE = [1, "SRP-2026-10", "AC Panasonic 2 PK CS-YN18AKJ", "9078737678", 7500000];

export type CatalogRow = { prod_id: string; product_name: string; srp_id: string | null; price_srp: number | null };

// "Rp 7.500.000" / "7,500,000" / 7500000 / "12,5" -> number (null when empty or not a number)
export function parsePrice(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").replace(/rp/i, "").replace(/\s/g, "");
  if (!s || s === "-") return null;
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
  else s = s.replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Finds the header row (the first 10 rows), maps the columns by name, and returns the product rows.
export function parseCatalogMatrix(matrix: unknown[][]): { rows: CatalogRow[]; skipped: { row: number; reason: string }[]; error?: string } {
  let h = -1; let col: Record<string, number> = {};
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const cells = (matrix[i] || []).map(norm);
    const idx = (names: string[]) => cells.findIndex((c) => names.includes(c));
    const prod = idx(["prodid", "productid", "idproduk", "kodeproduk"]), name = idx(["productname", "namaproduk", "produk", "product", "itemproduct"]);
    if (prod >= 0 && name >= 0) { h = i; col = { prod, name, srp: idx(["srpid"]), price: idx(["pricesrp", "srp", "hargasrp", "price"]) }; break; }
  }
  if (h < 0) return { rows: [], skipped: [], error: "Header row not found. The sheet needs the columns Product Name and Prod ID (use the template)." };
  const rows: CatalogRow[] = []; const skipped: { row: number; reason: string }[] = []; const seen = new Set<string>();
  for (let r = h + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    const prod_id = String(row[col.prod] ?? "").trim(), product_name = String(row[col.name] ?? "").trim();
    if (!prod_id || !product_name) { skipped.push({ row: r + 1, reason: "Prod ID and Product Name are required" }); continue; }
    if (seen.has(prod_id)) { skipped.push({ row: r + 1, reason: `Prod ID ${prod_id} appears twice in the sheet` }); continue; }
    seen.add(prod_id);
    rows.push({ prod_id, product_name, srp_id: col.srp >= 0 ? (String(row[col.srp] ?? "").trim() || null) : null, price_srp: col.price >= 0 ? parsePrice(row[col.price]) : null });
  }
  return { rows, skipped };
}
