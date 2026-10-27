// XLS template / import of the Massive Calculator. One flat sheet, one row per calculator line:
//   No | Prod ID | Product Name | Modal Produk | Harga Jual | Platform | Jenis Toko | Category | Sub Category | Jenis Product | Target ROAS |
//   Berat (kg) | Uk PxLxT (cm3) | Gratis Ongkir | Promo Xtra | Paylater 3 Bln | Paylater 6 Bln | Biaya Lain
// Prod ID must be a product of the SRP in force (Product Catalog); its name, Harga Beli and Harga SRP are read from there
// (Modal Produk left empty = Harga Beli, Harga Jual left empty = Harga SRP).
// A line is identified by Prod ID + Platform + Jenis Toko: importing the same line again updates it instead of adding a duplicate.
import { parsePrice } from "./catalogXls";

export const CALC_HEADER = [
  "No", "Prod ID", "Product Name", "Modal Produk", "Harga Jual", "Platform", "Jenis Toko", "Category", "Sub Category", "Jenis Product",
  "Target ROAS", "Berat (kg)", "Uk PxLxT (cm3)", "Gratis Ongkir", "Promo Xtra", "Paylater 3 Bln", "Paylater 6 Bln", "Biaya Lain",
] as const;
export const CALC_EXAMPLE = [1, "9078737678", "AC Panasonic 2 PK CS-YN18AKJ", 5800000, "", "Shopee", "Star", "Elektronik", "AC", "AC Split", 8, 28, 52000, "Yes", "Yes", "No", "No", 0];

export type FeeKey = { id: string; category: string; sub_category: string | null; jenis_product: string | null; platform: string; jenis_toko: string | null };
export const feeKeyOf = (f: { category?: string | null; sub_category?: string | null; jenis_product?: string | null; platform?: string | null; jenis_toko?: string | null }) =>
  [f.category, f.sub_category, f.jenis_product, f.platform, f.jenis_toko].map((x) => String(x ?? "").trim().toLowerCase()).join("|");

export type CalcPayload = {
  prod_id: string; item_product: string; modal_produk_rp: number; harga_jual_rp: number; fee_id: string | null; target_roas: number; berat_kg: number; ukuran_cm3: number;
  gratis_ongkir_on: boolean; promo_xtra_on: boolean; paylater_3mo_on: boolean; paylater_6mo_on: boolean; biaya_lain_rp: number;
};
export type ParsedCalc = { rows: (CalcPayload & { platform: string; toko: string })[]; skipped: { row: number; reason: string }[]; matched: number; unmatched: number; error?: string };

const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const yes = (v: unknown, dflt: boolean) => { const s = String(v ?? "").trim().toLowerCase(); if (!s) return dflt; return ["yes", "y", "ya", "true", "1", "on"].includes(s); };
const num = (v: unknown) => parsePrice(v) ?? 0;

// True when the first rows hold this flat template (so the server knows it is not the old 3-row-header layout).
export function isFlatTemplate(matrix: unknown[][]): boolean {
  return matrix.slice(0, 10).some((r) => { const c = (r || []).map(norm); return c.includes("prodid") && c.includes("modalproduk"); });
}

export function parseCalcMatrix(matrix: unknown[][], catalog: Map<string, { name: string; srp: number | null; beli?: number | null }>, fees: FeeKey[]): ParsedCalc {
  let h = -1;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) { const c = (matrix[i] || []).map(norm); if (c.includes("prodid") && c.includes("modalproduk")) { h = i; break; } }
  if (h < 0) return { rows: [], skipped: [], matched: 0, unmatched: 0, error: "Header row not found (the sheet needs Prod ID and Modal Produk: use the template)." };
  const cells = (matrix[h] || []).map(norm);
  const at = (...names: string[]) => cells.findIndex((c) => names.includes(c));
  const I = {
    prod: at("prodid"), modal: at("modalproduk"), harga: at("hargajual"), platform: at("platform"), toko: at("jenistoko"), cat: at("category"), sub: at("subcategory"),
    jenis: at("jenisproduct"), roas: at("targetroas"), berat: at("beratkg"), uk: at("ukpxlxtcm3"), ongkir: at("gratisongkir"), promo: at("promoxtra"),
    p3: at("paylater3bln"), p6: at("paylater6bln"), lain: at("biayalain"),
  };
  const feeMap = new Map(fees.map((f) => [feeKeyOf(f), f.id]));
  const rows: ParsedCalc["rows"] = []; const skipped: ParsedCalc["skipped"] = []; const seen = new Set<string>();
  let matched = 0, unmatched = 0;
  const get = (row: unknown[], i: number) => (i < 0 ? "" : row[i]);
  for (let r = h + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    const prod = String(get(row, I.prod) ?? "").trim();
    if (!prod) { skipped.push({ row: r + 1, reason: "Prod ID is empty" }); continue; }
    const p = catalog.get(prod);
    if (!p) { skipped.push({ row: r + 1, reason: `Prod ID ${prod} is not in the Product Catalog` }); continue; }
    const platform = String(get(row, I.platform) ?? "").trim(), toko = String(get(row, I.toko) ?? "").trim();
    const key = `${prod}|${platform.toLowerCase()}|${toko.toLowerCase()}`;
    if (seen.has(key)) { skipped.push({ row: r + 1, reason: `${prod} with ${platform || "no platform"} / ${toko || "no toko"} appears twice in the sheet` }); continue; }
    seen.add(key);
    const feeId = feeMap.get(feeKeyOf({ category: String(get(row, I.cat) ?? ""), sub_category: String(get(row, I.sub) ?? ""), jenis_product: String(get(row, I.jenis) ?? ""), platform, jenis_toko: toko })) ?? null;
    if (feeId) matched++; else unmatched++;
    const hargaCell = get(row, I.harga);
    rows.push({
      prod_id: prod, item_product: p.name, modal_produk_rp: String(get(row, I.modal) ?? "").trim() === "" ? (p.beli ?? 0) : num(get(row, I.modal)), harga_jual_rp: String(hargaCell ?? "").trim() === "" ? (p.srp ?? 0) : num(hargaCell),
      fee_id: feeId, target_roas: num(get(row, I.roas)), berat_kg: num(get(row, I.berat)), ukuran_cm3: num(get(row, I.uk)),
      gratis_ongkir_on: yes(get(row, I.ongkir), true), promo_xtra_on: yes(get(row, I.promo), true), paylater_3mo_on: yes(get(row, I.p3), false), paylater_6mo_on: yes(get(row, I.p6), false),
      biaya_lain_rp: num(get(row, I.lain)), platform: platform.toLowerCase(), toko: toko.toLowerCase(),
    });
  }
  return { rows, skipped, matched, unmatched };
}
