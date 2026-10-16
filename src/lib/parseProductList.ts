// Product list from the SPOS file (Shopee product performance): one entry per Product ID + Variant ID.
// Used by the Harga Beli page ("Upload product list"); parsed in the browser so only the (small) distinct list
// is sent to the server, never the 30,000-row file.
export interface ProductListRow {
  kode_produk: string;
  nama_produk: string;
  kode_variasi: string;   // "-" = the product itself (no variant)
  nama_variasi: string;   // "-" when there is no variant
}
export interface ProductListParsed { rows: ProductListRow[]; lossy: number; lines: number }

// Shopee IDs are 9-12 digit numbers. A cell stored as a number gives a number; a cell saved as CSV / by Excel may
// already be "2.37386E+11" (digits lost for good) - counted in `lossy` so the page can warn.
function idOf(v: unknown): { id: string; lossy: boolean } {
  if (typeof v === "number" && Number.isFinite(v)) return { id: Math.round(v).toFixed(0), lossy: false };
  const s = String(v ?? "").trim();
  return { id: s, lossy: /^\d+(\.\d+)?e\+?\d+$/i.test(s) };
}
const text = (v: unknown) => String(v ?? "").trim();

export function parseProductList(matrix: unknown[][]): ProductListParsed {
  const hi = matrix.findIndex((r) => (r || []).some((c) => text(c) === "Kode Produk"));
  if (hi < 0) return { rows: [], lossy: 0, lines: 0 };
  const header = Array.from(matrix[hi] || [], (h) => text(h));
  const iProd = header.indexOf("Kode Produk");
  const iName = header.indexOf("Produk");
  const iVar = header.indexOf("Kode Variasi");
  const iVarName = header.indexOf("Nama Variasi");
  if (iProd < 0 || iName < 0) return { rows: [], lossy: 0, lines: 0 };

  const seen = new Map<string, ProductListRow>();
  let lossy = 0, lines = 0;
  for (let r = hi + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const prod = idOf(row[iProd]);
    if (!prod.id || prod.id === "-") continue;
    lines++;
    const variation = iVar >= 0 ? idOf(row[iVar]) : { id: "-", lossy: false };
    const kodeVar = variation.id || "-";
    const key = `${prod.id}|${kodeVar}`;
    if (seen.has(key)) continue;
    if (prod.lossy || (variation.lossy && kodeVar !== "-")) lossy++;
    seen.set(key, {
      kode_produk: prod.id,
      nama_produk: text(row[iName]),
      kode_variasi: kodeVar,
      nama_variasi: (iVarName >= 0 ? text(row[iVarName]) : "") || "-",
    });
  }
  return { rows: [...seen.values()], lossy, lines };
}
