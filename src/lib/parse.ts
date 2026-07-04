// Ported from the GAS Upload.gs brand/category detection — behaviour-identical.

export const BRAND_LIST = [
  "Panasonic", "Sharp", "Polytron", "Gree", "Daikin", "LG", "Samsung", "Midea",
  "Modena", "Bosch", "Electrolux", "Beko", "Hitachi", "Ariston", "Gea", "Philips",
  "Toshiba", "TCL", "Reiwa", "AQUA", "Xiaomi", "Teka", "Changhong", "Mitsubishi",
];

// Multi-word phrases first so the more specific one wins; "AC" last & boundary-safe.
export const CATEGORY_LIST = [
  "Mesin Cuci", "Kipas Angin", "Hair Dryer", "Rice Cooker", "Water Heater",
  "Magic Com", "Kulkas", "Dispenser", "Blender", "Setrika", "Frezzer", "Fan", "TV", "AC",
];

// Canonical Indonesian month names — exactly one spelling per month.
// "Mei" has no shorter form — it's already 3 letters.
export const MONTH_LIST = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

// Some source files (notably certain Performa exports) abbreviate the month
// in their "Bulan" column ("Jan", "Feb", "Mar", ...), or misspell it
// ("Febuari" instead of "Februari"), while Ads/SPOS files for the same
// period use the canonical full name. Since every chart and filter groups by
// exact month-string match, this silently splits one real month into two
// separate buckets — the abbreviated/misspelled one showing sales/GMV with
// no matching ad cost, and vice versa. Normalize to the canonical full name
// so every source lands in the same bucket.
const MONTH_ABBR: Record<string, string> = {
  jan: "Januari", feb: "Februari", febuari: "Februari", mar: "Maret", apr: "April",
  jun: "Juni", jul: "Juli", agu: "Agustus", aug: "Agustus",
  sep: "September", okt: "Oktober", oct: "Oktober",
  nov: "November", des: "Desember", dec: "Desember",
};

export function normalizeMonth(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  if (MONTH_LIST.includes(s)) return s; // already canonical (incl. "Mei", "Month Awal" passes through below)
  const key = s.toLowerCase().replace(/\.$/, "");
  return MONTH_ABBR[key] ?? s; // unrecognized values (e.g. "Month Awal") pass through unchanged
}

// Case-insensitive whole-word regex; \b means "AC" won't match inside "Hitachi".
function wordRe(term: string): RegExp {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + esc + "\\b", "i");
}

// Longer/more-specific terms must be tried first so e.g. "Kipas Angin" wins
// over a bare "AC"/"Fan", and multi-word brand names win over substrings.
// This makes the ordering safe regardless of how the caller's list (e.g. the
// Core List from the DB) happens to be sorted.
function bySpecificity(list: string[]): string[] {
  return [...list].sort((a, b) => b.length - a.length);
}

export function detectBrand(name: unknown, brands: string[] = BRAND_LIST): string {
  const s = String(name ?? "");
  if (/non\s*panasonic|bukan\s*panasonic/i.test(s)) return "Others";
  for (const b of bySpecificity(brands)) if (wordRe(b).test(s)) return b;
  return "Others";
}

export function detectCategory(name: unknown, categories: string[] = CATEGORY_LIST): string {
  const s = String(name ?? "");
  for (const c of bySpecificity(categories)) if (wordRe(c).test(s)) return c;
  return "Others";
}

// Mimic BigQuery's column-name sanitization (kept so raw keys match the old data).
export function bqCol(h: unknown): string {
  return String(h).trim().replace(/[^A-Za-z0-9]/g, "_");
}

// Parse a Shopee numeric string to a whole number or null.
// Shopee xlsx exports usually use Indonesian formatting where dots/commas are
// THOUSAND separators (e.g. "24.759.000" = 24759000), but some cells (notably
// "Month Awal" baseline rows and count columns) render with a genuine 2-digit
// decimal/cents suffix instead, e.g. "111,774,820.00" or "45,00". A trailing
// separator followed by exactly 2 digits is always a decimal marker in
// currency/count formatting — a thousands group is always 3 digits — so drop
// that suffix FIRST, then strip the remaining separators as thousands groups.
// Getting this order wrong merges the decimal into the integer and inflates
// the value 100x (e.g. "111,774,820.00" -> 11177482000 instead of 111774820).
//
// A trailing "%" is a separate issue: some source spreadsheet cells for
// money columns get mistakenly formatted as Excel "Percentage" (e.g. cell
// format "0.00%"), which multiplies the true stored value by 100 for
// display and appends "%" — e.g. a genuine Rp 1,390,696 renders as
// "139069600.00%". toNum() is only ever called on money/count columns
// (never on real percentage columns), so any "%" here is always this
// formatting bug — strip it and divide the parsed value back by 100.
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || s === "-") return null;
  s = s.replace(/rp/i, "").trim();
  if (!s || s === "-") return null;
  const wasPercentFormatted = s.endsWith("%");
  if (wasPercentFormatted) s = s.slice(0, -1).trim();
  if (!s || s === "-") return null;
  s = s.replace(/[.,]\d{2}$/, ""); // drop a genuine 2-digit decimal/cents suffix
  s = s.replace(/[.,\s%]/g, "");
  if (!s || s === "-") return null;
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (wasPercentFormatted) n = n / 100;
  return n;
}

export type DataSource = "spos" | "ads" | "perf";

// The shared manual fields entered once per upload (same for the whole file).
export interface ManualFields {
  admin?: string;
  bulan?: string;          // data month name
  baseline_month?: string; // "Bulan Awal" baseline month for dashboard comparison
  year?: number;
  city?: string;
  pic_client?: string;  // was "PIC Panasonic"
  store_name?: string;  // was "Dealer"
  brand?: string;       // auto-filled from store_links when store is picked
  week?: string;
  grup_iklan?: string;       // Ads: the ad group this whole file belongs to (one group per file)
  ads_level?: string;        // Ads: Incubation | Hero | Regular | Low Conversion
  tanggal_mulai?: string;    // Monday — start of the data week
  tanggal_berakhir?: string; // Sunday — auto = tanggal_mulai + 6 days
  tanggal_input?: string;    // ISO timestamp when the upload was entered (log)
  tanggal?: string;
}

// Which raw column holds the name we derive brand/category from, per source.
const NAME_COL: Record<DataSource, string | null> = {
  spos: "Produk",
  ads: "Nama Iklan/Produk", // Shopee keyword-placement report column; falls back below
  perf: null,
};

// Map a parsed raw row -> the typed sales_rows fields. Metric extraction picks
// the best-matching Shopee column per source; raw keeps everything verbatim.
// `dicts` lets the caller pass the workspace's live Core List brands/categories
// (master_data) instead of the hardcoded fallback lists — so a brand/category
// added in Core List is picked up on the very next upload with no code change.
export function mapRow(
  source: DataSource,
  raw: Record<string, unknown>,
  manual: ManualFields,
  dicts?: { brands?: string[]; categories?: string[] }
) {
  const get = (k: string) => raw[k] ?? raw[bqCol(k)];

  const nameCol = NAME_COL[source];
  // For ads, the Shopee export may use "Nama Iklan/Produk" or just "Nama Iklan"
  const name = nameCol
    ? (get(nameCol) ?? (source === "ads" ? get("Nama Iklan") : null))
    : null;

  // Prefer the Brand / Tipe Produk column if the export already carries it;
  // otherwise auto-detect from the product/campaign name.
  const storedBrand = String(get("Brand") ?? "").trim();
  const storedType = String(get("Tipe Produk") ?? "").trim();
  const brandList = dicts?.brands?.length ? dicts.brands : BRAND_LIST;
  const categoryList = dicts?.categories?.length ? dicts.categories : CATEGORY_LIST;
  const brand = (storedBrand && storedBrand !== "-")
    ? storedBrand
    : (nameCol ? detectBrand(name, brandList) : null);
  const product_type = (storedType && storedType !== "-")
    ? storedType
    : (nameCol ? detectCategory(name, categoryList) : null);

  // SPOS parent-row rule: count only rows where traffic (visitors) is present.
  const visitorsSpos = toNum(get("Pengunjung Produk (Kunjungan)"));
  const isParent =
    source === "spos" ? visitorsSpos !== null && visitorsSpos !== undefined : true;

  // Source-specific metric mapping.
  let sales_idr: number | null = null;
  let orders: number | null = null;
  let units: number | null = null;
  let visitors: number | null = null;
  let ad_cost: number | null = null;
  let in_cart: number | null = null;
  let penjualan_langsung: number | null = null;

  if (source === "spos") {
    // GAS uses "Pesanan Siap Dikirim" (ready-to-ship), NOT "Pesanan Dibuat"
    sales_idr = toNum(get("Penjualan (Pesanan Siap Dikirim) (IDR)"));
    orders = toNum(get("Total Pembeli (Pesanan Dibuat)"));
    units = toNum(get("Produk (Pesanan Dibuat)"));
    visitors = visitorsSpos;
    in_cart = toNum(get("Dimasukkan ke Keranjang (Produk)"));
  } else if (source === "ads") {
    sales_idr = toNum(get("Omzet Penjualan"));
    orders = toNum(get("Konversi"));
    units = toNum(get("Produk Terjual"));
    visitors = toNum(get("Dilihat"));
    ad_cost = toNum(get("Biaya"));
    // "Penjualan Langsung (GMV Langsung)" — the direct sales used for group ROAS.
    penjualan_langsung = toNum(get("Penjualan Langsung (GMV Langsung)"))
      ?? toNum(get("Penjualan Langsung"));
  } else {
    // perf — GMV = "Penjualan (Pesanan Siap Dikirim) (IDR)"
    sales_idr = toNum(get("Penjualan (Pesanan Siap Dikirim) (IDR)"));
    orders = toNum(get("Total Pembeli (Pesanan Dibuat)"));
    units = toNum(get("Total Produk Dipesan"));
    visitors = toNum(get("Total Pengunjung (Kunjungan)"));
  }

  // The one raw field still needed downstream (ads_detail's product code).
  // Kept as a real column so we can STOP storing the full `raw` blob —
  // that blob averaged ~2.5 KB/row (~1.2 GB across the table) and was the
  // dominant cost of every unindexed dashboard scan.
  const kodeRaw = get("Kode Produk");
  const kode_produk = kodeRaw != null && String(kodeRaw).trim() !== "" ? String(kodeRaw) : null;

  return {
    source,
    year: manual.year ?? null,
    month: normalizeMonth(manual.bulan) ?? null,
    week: manual.week ?? null,
    city: manual.city ?? null,
    store_name: manual.store_name ?? null,
    pic_client: manual.pic_client ?? null,
    brand,
    product_type,
    item_name: name != null ? String(name) : null,
    kode_produk,
    grup_iklan: source === "ads" ? (manual.grup_iklan ?? null) : null,
    ads_level:  source === "ads" ? (manual.ads_level  ?? null) : null,
    tanggal: manual.tanggal || manual.tanggal_mulai || null,
    sales_idr,
    orders,
    units,
    visitors,
    ad_cost,
    in_cart,
    penjualan_langsung,
    is_parent: isParent,
    // `raw` intentionally NOT stored anymore — the DB column defaults to
    // '{}' so rows stay narrow. Source files remain the system of record
    // if the full original row is ever needed again.
  };
}
