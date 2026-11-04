// XLS export / import of ONE SRP Price Calculation (Perhitungan Harga > an SRP): one flat sheet, one row per calculator line.
//   No | Prod ID | Product Name | Modal Produk | Harga Jual | Platform | Jenis Toko | Category | Sub Category | Jenis Product | Product Line |
//   Target ROAS | Berat (kg) | Uk PxLxT (cm3) | Gratis Ongkir | Promo Xtra | Paylater 3 Bln | Paylater 6 Bln | Biaya Lain | Total Biaya | Profit
// A line is identified by Prod ID + Platform + Jenis Toko: importing a known line UPDATES it (only the cells that are filled), a new one is ADDED.
// Platform + Jenis Toko + Category + Sub Category + Jenis Product link the line to its Marketplace Fee row. Total Biaya and Profit are only for reading.
import { parsePrice } from "./catalogXls";

export const CALC_HEADER = [
  "No", "Prod ID", "Product Name", "Modal Produk", "Harga Jual", "Platform", "Jenis Toko", "Category", "Sub Category", "Jenis Product", "Product Line",
  "Target ROAS", "Berat (kg)", "Uk PxLxT (cm3)", "Gratis Ongkir", "Promo Xtra", "Paylater 3 Bln", "Paylater 6 Bln", "Biaya Lain", "Total Biaya", "Profit",
] as const;

export type FeeKeyParts = { category?: string | null; sub_category?: string | null; jenis_product?: string | null; platform?: string | null; jenis_toko?: string | null };
export const feeKeyOf = (f: FeeKeyParts) =>
  [f.category, f.sub_category, f.jenis_product, f.platform, f.jenis_toko].map((x) => String(x ?? "").trim().toLowerCase()).join("|");
export const lineKeyOf = (prod: string, platform: string | null | undefined, toko: string | null | undefined) =>
  `${prod.trim()}|${String(platform ?? "").trim().toLowerCase()}|${String(toko ?? "").trim().toLowerCase()}`;

// a cell that is not filled stays undefined: an update then leaves that value of the line alone
export type CalcXlsRow = {
  prod_id: string; item_product?: string; modal_produk_rp?: number; harga_jual_rp?: number;
  platform: string; toko: string; fee?: FeeKeyParts; product_line?: string;
  target_roas?: number; berat_kg?: number; ukuran_cm3?: number;
  gratis_ongkir_on?: boolean; promo_xtra_on?: boolean; paylater_3mo_on?: boolean; paylater_6mo_on?: boolean; biaya_lain_rp?: number;
};
export type ParsedCalcXls = { rows: CalcXlsRow[]; skipped: { row: number; reason: string }[]; error?: string };

const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const filled = (v: unknown) => String(v ?? "").trim() !== "";
const yesNo = (v: unknown): boolean | undefined => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return undefined;
  return ["yes", "y", "ya", "true", "1", "on"].includes(s);
};
const numOf = (v: unknown): number | undefined => (filled(v) ? parsePrice(v) ?? undefined : undefined);

export function parseCalcXls(matrix: unknown[][]): ParsedCalcXls {
  let h = -1;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const c = (matrix[i] || []).map(norm);
    if (c.includes("prodid") && (c.includes("modalproduk") || c.includes("hargajual"))) { h = i; break; }
  }
  if (h < 0) return { rows: [], skipped: [], error: "Header row not found (the sheet needs Prod ID and Modal Produk / Harga Jual: use Export XLS as the template)." };
  const cells = (matrix[h] || []).map(norm);
  const at = (...names: string[]) => cells.findIndex((c) => names.includes(c));
  const I = {
    prod: at("prodid"), name: at("productname"), modal: at("modalproduk"), harga: at("hargajual"), platform: at("platform"), toko: at("jenistoko"),
    cat: at("category"), sub: at("subcategory"), jenis: at("jenisproduct"), line: at("productline"), roas: at("targetroas"), berat: at("beratkg"), uk: at("ukpxlxtcm3"),
    ongkir: at("gratisongkir"), promo: at("promoxtra"), p3: at("paylater3bln"), p6: at("paylater6bln"), lain: at("biayalain"),
  };
  const get = (row: unknown[], i: number) => (i < 0 ? "" : row[i]);
  const text = (row: unknown[], i: number) => String(get(row, i) ?? "").trim();
  const rows: CalcXlsRow[] = []; const skipped: ParsedCalcXls["skipped"] = []; const seen = new Set<string>();
  for (let r = h + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    if (!row.some(filled)) continue;
    const prod = text(row, I.prod);
    if (!prod) { skipped.push({ row: r + 1, reason: "Prod ID is empty" }); continue; }
    const platform = text(row, I.platform), toko = text(row, I.toko);
    const key = lineKeyOf(prod, platform, toko);
    if (seen.has(key)) { skipped.push({ row: r + 1, reason: `${prod} with ${platform || "no platform"} / ${toko || "no toko"} appears twice in the sheet` }); continue; }
    seen.add(key);
    const fee: FeeKeyParts = { category: text(row, I.cat), sub_category: text(row, I.sub), jenis_product: text(row, I.jenis), platform, jenis_toko: toko };
    rows.push({
      prod_id: prod, item_product: text(row, I.name) || undefined, modal_produk_rp: numOf(get(row, I.modal)), harga_jual_rp: numOf(get(row, I.harga)),
      platform, toko, fee: platform && toko && fee.category ? fee : undefined, product_line: filled(get(row, I.line)) ? text(row, I.line) : undefined,
      target_roas: numOf(get(row, I.roas)), berat_kg: numOf(get(row, I.berat)), ukuran_cm3: numOf(get(row, I.uk)),
      gratis_ongkir_on: yesNo(get(row, I.ongkir)), promo_xtra_on: yesNo(get(row, I.promo)), paylater_3mo_on: yesNo(get(row, I.p3)), paylater_6mo_on: yesNo(get(row, I.p6)),
      biaya_lain_rp: numOf(get(row, I.lain)),
    });
  }
  return { rows, skipped };
}
