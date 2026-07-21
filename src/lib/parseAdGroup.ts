// Parser for Shopee's "Data Grup Iklan" / Shop GMV Max export — a
// structurally different file from the flat "Ads Performa" export handled by
// parse.ts. Ported from the ProfTokoOnline blueprint's parseAdGroup.ts,
// feeding Reline's ad_groups table (Supabase Migration/30).
//
// Shape of the file:
//   - a label:value preamble (report title with the group name, username,
//     store name, "Periode" date range)
//   - then a header row located dynamically ("Nama Iklan" / "Nama Produk")
//   - then a group-total row + one row per product.
import { toNum } from "./parse";

export type AdGroupRow = {
  level: "group" | "product";
  item_name: string | null;
  kode_produk: string | null;
  dilihat: number | null;
  klik: number | null;
  konversi: number | null;
  konversi_langsung: number | null;
  produk_terjual: number | null;
  terjual_langsung: number | null;
  add_to_cart: number | null;
  omzet: number | null;
  penjualan_langsung: number | null;
  biaya: number | null;
  roas: number | null;
  roas_langsung: number | null;
};

export type ParsedAdGroup = {
  grupIklan: string | null;
  periodeStart: string | null; // ISO
  periodeEnd: string | null;   // ISO
  storeName: string | null;
  rows: AdGroupRow[];
};

const s = (v: unknown) => String(v ?? "").trim();
const lc = (v: unknown) => s(v).toLowerCase();

// dd/mm/yyyy -> yyyy-mm-dd (Shopee's Indonesian date format).
function idDateToISO(v: unknown): string | null {
  const m = s(v).match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Scan the first ~20 rows for the header row (the one naming the campaign/
// product column). Returns its index or -1.
function findHeader(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const cells = (matrix[i] || []).map(lc);
    if (cells.some((c) => c.includes("nama iklan") || c.includes("nama produk"))) return i;
  }
  return -1;
}

// Map a header row -> column index by a set of bilingual substrings (first
// match wins). Header order never changes across Shopee's languages, but we
// match by name for resilience.
function colIndexer(header: unknown[]) {
  const h = header.map(lc);
  return (...names: string[]): number => {
    for (const n of names) {
      const idx = h.findIndex((c) => c.includes(n.toLowerCase()));
      if (idx !== -1) return idx;
    }
    return -1;
  };
}

// Like colIndexer's lookup but skips a specific column index — used to
// disambiguate a substring that also matches a more-specific header (e.g.
// "Konversi" vs "Konversi Langsung").
function colExcept(header: unknown[], name: string, exclude: number): number {
  const needle = name.toLowerCase();
  return header.map(lc).findIndex((c, i) => i !== exclude && c.includes(needle));
}

export function parseAdGroupMatrix(matrix: unknown[][]): ParsedAdGroup {
  // ── preamble: title (group name), store, period ──
  let grupIklan: string | null = null;
  let periodeStart: string | null = null;
  let periodeEnd: string | null = null;
  let storeName: string | null = null;

  const headerIdx = findHeader(matrix);
  const preambleEnd = headerIdx === -1 ? Math.min(matrix.length, 15) : headerIdx;
  for (let i = 0; i < preambleEnd; i++) {
    const joined = (matrix[i] || []).map(s).filter(Boolean).join(" ");
    if (!joined) continue;
    // "Laporan <Group Name> - Shopee"
    const g = joined.match(/laporan\s+(.+?)\s+-\s+shopee/i);
    if (g && !grupIklan) grupIklan = g[1].trim();
    // "Periode: dd/mm/yyyy - dd/mm/yyyy"
    if (/periode/i.test(joined)) {
      const dates = joined.match(/\d{1,2}[/-]\d{1,2}[/-]\d{4}/g);
      if (dates && dates.length >= 1) {
        periodeStart = idDateToISO(dates[0]);
        periodeEnd = idDateToISO(dates[1] ?? dates[0]);
      }
    }
    // "Nama Toko: ..." / "Toko: ..."
    const st = joined.match(/(?:nama\s+toko|toko)\s*[:：]\s*(.+)$/i);
    if (st && !storeName) storeName = st[1].trim();
  }

  if (headerIdx === -1) return { grupIklan, periodeStart, periodeEnd, storeName, rows: [] };

  const header = matrix[headerIdx] || [];
  const col = colIndexer(header);
  const iName    = col("nama iklan", "nama produk", "nama");
  const iKode    = col("kode produk", "kode");
  const iDilihat = col("dilihat", "impression");
  const iKlik    = col("jumlah klik", "klik", "click");
  // "Konversi" is a substring of "Konversi Langsung" — resolve the more
  // specific "langsung" column first, then take the plain Konversi column as
  // the first "konversi" header that ISN'T the langsung one.
  const iKonvL   = col("konversi langsung");
  const iKonv    = colExcept(header, "konversi", iKonvL);
  const iTerjualL= col("terjual langsung");
  const iTerjual = colExcept(header, "terjual", iTerjualL); // "Produk Terjual" (not "Terjual Langsung")
  const iCart    = col("add to cart", "keranjang", "masuk keranjang");
  const iOmzet   = col("omzet penjualan", "omzet");
  const iPenjL   = col("penjualan langsung");
  const iBiaya   = col("biaya", "cost");
  const iRoasL   = col("efektivitas langsung", "efektifitas langsung", "roas langsung");
  const iRoas    = colExcept(header, "efektifitas iklan", iRoasL) !== -1
    ? colExcept(header, "efektifitas iklan", iRoasL)
    : colExcept(header, "efektivitas iklan", iRoasL);

  const rows: AdGroupRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] || [];
    if (!r.some((c) => s(c) !== "")) continue; // blank row
    const name = iName === -1 ? null : s(r[iName]) || null;
    if (!name) continue;
    const kodeRaw = iKode === -1 ? "" : s(r[iKode]);
    const kode = kodeRaw && kodeRaw !== "-" ? kodeRaw : null;
    // level: "group" when the row has no real product code OR its name is the
    // group name itself; otherwise a product row.
    const isGroup = !kode || (grupIklan != null && lc(name) === lc(grupIklan)) || lc(name) === "shop gmv max";
    const at = (idx: number) => (idx === -1 ? null : toNum(r[idx]));
    rows.push({
      level: isGroup ? "group" : "product",
      item_name: name,
      kode_produk: kode,
      dilihat: at(iDilihat),
      klik: at(iKlik),
      konversi: at(iKonv),
      konversi_langsung: at(iKonvL),
      produk_terjual: at(iTerjual),
      terjual_langsung: at(iTerjualL),
      add_to_cart: at(iCart),
      omzet: at(iOmzet),
      penjualan_langsung: at(iPenjL),
      biaya: at(iBiaya),
      roas: at(iRoas),
      roas_langsung: at(iRoasL),
    });
  }

  return { grupIklan, periodeStart, periodeEnd, storeName, rows };
}

// Fallback ad-level guess from the group name when the caller sends no
// explicit level (mirrors the blueprint's inferGroupLevel).
export function inferGroupLevel(grupIklan: string | null | undefined): string {
  const g = lc(grupIklan);
  if (g.includes("gmv max")) return "incubation";
  if (g.includes("hero")) return "hero";
  if (g.includes("low")) return "low_conversion";
  return "regular";
}
