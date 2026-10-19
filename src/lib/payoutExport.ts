import * as XLSX from "xlsx";
import { fmtDate } from "@/lib/dates";

// A payout, as saved by the SQL function payout_create (Supabase Migration/67) and returned by payout_lines_of.
export type PayoutBatch = {
  id: string; payout_no: string | null; vendor_id?: string | null; vendor_name?: string | null; store_name: string; dealer_city?: string | null;
  order_count: number; line_count: number; total_qty: number; total: number;
  note: string | null; created_by_name: string | null; created_at: string;
  status?: string | null; proof_name?: string | null; proof_at?: string | null; receipt_name?: string | null; receipt_at?: string | null;
  faktur_name?: string | null; faktur_at?: string | null; bukpot_name?: string | null; bukpot_at?: string | null; tax_status?: string | null;
};
export type PayoutLine = {
  store_name?: string | null;
  order_no: string; shipped_at: string | null; withdraw_at: string | null; completed_at: string | null;
  product_id: string | null; product_name: string | null; variant_id: string | null; variant_name: string | null;
  qty: number; harga_beli: number; total: number;
};
export type SummaryRow = {
  product_id: string; product_name: string; variant_id: string; variant_name: string; qty: number; harga_beli: number; total: number;
};

// Summary sheet / page: one row per product + variant + price, quantities and totals added up.
export function summarize(lines: PayoutLine[]): SummaryRow[] {
  const m = new Map<string, SummaryRow>();
  for (const l of lines) {
    const key = `${l.product_id ?? ""}|${l.variant_id ?? "-"}|${l.harga_beli}`;
    const r = m.get(key) ?? {
      product_id: l.product_id ?? "", product_name: l.product_name ?? "", variant_id: l.variant_id ?? "-", variant_name: l.variant_name ?? "-",
      qty: 0, harga_beli: Number(l.harga_beli) || 0, total: 0,
    };
    r.qty += Number(l.qty) || 0;
    r.total += Number(l.total) || 0;
    m.set(key, r);
  }
  return [...m.values()].sort((a, b) => a.product_name.localeCompare(b.product_name) || a.product_id.localeCompare(b.product_id) || a.variant_name.localeCompare(b.variant_name));
}

export const SUMMARY_HEAD = ["ID Product", "Nama Prod", "ID Variasi", "Variasi", "Qty", "Harga Beli", "PPN (11%)", "Total"] as const;
export const DETAIL_HEAD = ["No Pesanan", "Store", "Tgl Kirim", "Tgl Withdraw", "ID Prod", "Nama Prod", "ID Variasi", "Variasi", "Qty", "Harga Beli", "PPN (11%)", "Total"] as const;

// Harga Beli includes PPN (12% x DPP 11/12 = 11% effective): the PPN inside an amount is amount - amount / 1.11
export const ppnOf = (amount: number) => Math.round(Number(amount) - Number(amount) / 1.11);

export const dateOrDash = (d: string | null) => (d ? fmtDate(d) : "—");

export function exportFileName(b: PayoutBatch, ext: "xlsx" | "pdf"): string {
  const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
  return `${safe(b.payout_no || "payout")}_${safe(b.vendor_name || b.store_name)}.${ext}`;
}

export function payoutInfoRows(b: PayoutBatch): string[][] {
  return [
    ["Payout", b.payout_no || ""], ["Vendor", b.vendor_name || "—"], ["Stores", b.store_name || ""],
    ["Created", fmtDate(b.created_at.slice(0, 10))],
  ];
}

// XLSX with two sheets: Summary and Detail. Money / quantity cells are real numbers (thousand separators by format).
export function buildPayoutXlsx(b: PayoutBatch, lines: PayoutLine[]): Buffer {
  const sum = summarize(lines);
  const info = payoutInfoRows(b);

  const summaryRows: (string | number)[][] = [
    ...info, [],
    [...SUMMARY_HEAD],
    ...sum.map((r) => [r.product_id, r.product_name, r.variant_id, r.variant_name, r.qty, r.harga_beli, ppnOf(r.total), r.total]),
    ["", "TOTAL", "", "", sum.reduce((a, r) => a + r.qty, 0), "", sum.reduce((a, r) => a + ppnOf(r.total), 0), sum.reduce((a, r) => a + r.total, 0)],
  ];
  const detailRows: (string | number)[][] = [
    ...info, [],
    [...DETAIL_HEAD],
    ...lines.map((l) => [l.order_no, l.store_name ?? "", l.shipped_at ? fmtDate(l.shipped_at) : "", l.withdraw_at ? fmtDate(l.withdraw_at) : "",
      l.product_id ?? "", l.product_name ?? "", l.variant_id ?? "-", l.variant_name ?? "-", Number(l.qty), Number(l.harga_beli), ppnOf(l.total), Number(l.total)]),
    ["", "", "", "", "", "TOTAL", "", "", lines.reduce((a, l) => a + Number(l.qty), 0), "", lines.reduce((a, l) => a + ppnOf(l.total), 0), lines.reduce((a, l) => a + Number(l.total), 0)],
  ];

  const wb = XLSX.utils.book_new();
  const put = (name: string, rows: (string | number)[][], numCols: number[], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    const ref = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let r = ref.s.r; r <= ref.e.r; r++) {
      for (const c of numCols) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.t === "n") cell.z = "#,##0";
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  put("Summary", summaryRows, [4, 5, 6, 7], [16, 48, 16, 20, 8, 14, 12, 16]);
  put("Detail", detailRows, [8, 9, 10, 11], [18, 16, 13, 14, 14, 48, 16, 20, 8, 14, 12, 16]);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
