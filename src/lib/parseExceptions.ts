// Parsers for the three Shopee exports that are NOT a completed order (Demographic > Retur):
//   Order.cancelled        one row per order line       (Alasan Pembatalan)
//   Order.failed_delivery  one row per order line       (Status pengiriman gagal, claim dates)
//   Order.return_refund    one row per return + product (No. Pengembalian)
// All three join to Order Completed / Earning by "No. Pesanan". Each row is filed under the year / month / week of its OWN date
// (cancel + failed: order created; return: return requested), so a range export spanning two months lands in both.
import { toNum } from "./parse";
import { MONTHS_ID, weekOfMonth } from "./parseFinance";

export type ExceptionKind = "cancel" | "failed" | "return";

export interface ExceptionRow {
  kind: ExceptionKind;
  row_key: string;
  year: number | null; month: string | null; week: string | null;
  ref_no: string | null; order_no: string | null;
  event_at: string | null; order_created_at: string | null;
  status: string | null; reason: string | null;
  product_name: string | null; variant_name: string | null;
  qty: number | null; amount: number | null; total_payment: number | null;
  payment_method: string | null; shipping_option: string | null; tracking_no: string | null;
  buyer_username: string | null; city: string | null; province: string | null;
  extra: Record<string, unknown>;
}

const str = (v: unknown): string | null => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
const ts = (v: unknown): string | null => { const s = String(v ?? "").trim(); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null; };

export function exceptionKindOf(matrix: unknown[][]): ExceptionKind | null {
  const h = Array.from(matrix[0] || [], (x) => String(x ?? "").trim());
  if (h.includes("No. Pengembalian") && h.includes("No. Pesanan")) return "return";
  if (h.includes("Status pengiriman gagal")) return "failed";
  if (h.includes("Alasan Pembatalan") && h.includes("No. Pesanan")) return "cancel";
  return null;
}

export function parseExceptionMatrix(matrix: unknown[][], kind: ExceptionKind): ExceptionRow[] {
  if (!matrix.length) return [];
  const header = Array.from(matrix[0] || [], (h) => String(h ?? "").trim());
  const idx = (name: string) => header.indexOf(name);          // first column of that name (Shopee repeats "Provinsi" etc.)
  const col = (row: unknown[], name: string) => { const i = idx(name); return i < 0 ? undefined : row[i]; };

  const out: ExceptionRow[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    if (!row.some((c) => c !== "" && c != null)) continue;
    const orderNo = str(col(row, "No. Pesanan"));
    if (!orderNo) continue;
    const isReturn = kind === "return";
    const refNo = isReturn ? str(col(row, "No. Pengembalian")) : null;
    const product = str(col(row, "Nama Produk"));
    const variant = str(isReturn ? col(row, "Variasi") : col(row, "Nama Variasi"));
    const created = ts(col(row, isReturn ? "Tanggal Pesanan Dibuat" : "Waktu Pesanan Dibuat"));
    const event = isReturn ? ts(col(row, "Waktu Pengembalian Diajukan")) : created;
    const day = event ? event.slice(0, 10) : null;
    const year = day ? Number(day.slice(0, 4)) : null;
    const month = day ? MONTHS_ID[Number(day.slice(5, 7)) - 1] : null;
    const week = day && year && month ? weekOfMonth(day, year, month) : null;

    const stem = `${isReturn ? refNo : orderNo}|${product ?? ""}|${variant ?? ""}`;
    let key = stem;
    for (let n = 2; seen.has(key); n++) key = `${stem}|${n}`; // the same product twice in one order
    seen.add(key);

    const base = { kind, row_key: key, year, month, week, ref_no: refNo, order_no: orderNo, event_at: event, order_created_at: created, product_name: product, variant_name: variant };
    if (kind === "return") {
      out.push({
        ...base,
        status: str(col(row, "Status Pembatalan/ Pengembalian")), reason: str(col(row, "Alasan Pengembalian")),
        qty: toNum(col(row, "Jumlah Produk Dikembalikan")), amount: toNum(col(row, "Total Pengembalian Dana")), total_payment: toNum(col(row, "Total Pesanan")),
        payment_method: str(col(row, "Metode Pembayaran")), shipping_option: str(col(row, "Pilihan Jasa Kirim Pengembalian Barang")), tracking_no: str(col(row, "No. Resi Pengembalian Barang")),
        buyer_username: str(col(row, "Username (Pembeli)")), city: str(col(row, "Kota/Kabupaten")), province: str(col(row, "Provinsi")),
        extra: {
          return_type: str(col(row, "Tipe Pengembalian")), solution: str(col(row, "Solusi Pengembalian Barang/Dana")), note: str(col(row, "Catatan Pengembalian Barang")),
          unit_price: toNum(col(row, "Harga Satuan")), refund_done_at: ts(col(row, "Waktu Pengembalian Dana Selesai")),
          goods_status: str(col(row, "Status Pengembalian Barang")), goods_done_at: ts(col(row, "Waktu Pengiriman Pengembalian Barang Selesai")),
          return_shipping_cost: toNum(col(row, "Ongkos Kirim Pengembalian")), fund_release: toNum(col(row, "Pelepasan Dana")), compensation: toNum(col(row, "Jumlah Kompensasi")),
        },
      });
    } else {
      out.push({
        ...base,
        status: str(col(row, kind === "failed" ? "Status pengiriman gagal" : "Status Pesanan")), reason: str(col(row, "Alasan Pembatalan")),
        qty: toNum(col(row, "Jumlah")), amount: toNum(col(row, "Subtotal Pesanan")), total_payment: toNum(col(row, "Total Pembayaran")),
        payment_method: str(col(row, "Metode Pembayaran")), shipping_option: str(col(row, "Opsi Pengiriman")), tracking_no: str(col(row, "No. Resi")),
        buyer_username: str(col(row, "Username (Pembeli)")), city: str(col(row, "Kota/Kabupaten")), province: str(col(row, "Provinsi")),
        extra: kind === "failed" ? {
          order_status: str(col(row, "Status Pesanan")), claim_status: str(col(row, "Status Klaim")),
          claim_filed_at: ts(col(row, "Tanggal Klaim Diajukan")), claim_approved_at: ts(col(row, "Tanggal Klaim Disetujui")),
          claim_paid_at: ts(col(row, "Tanggal Klaim Dicairkan")), claim_rejected_at: ts(col(row, "Tanggal Klaim Ditolak")), compensation: toNum(col(row, "Jumlah Kompensasi")),
        } : {},
      });
    }
  }
  return out;
}
