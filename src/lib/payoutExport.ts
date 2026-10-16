import * as XLSX from "xlsx";
import { fmtDate } from "@/lib/dates";

// A payout, as saved by the SQL function payout_create (Supabase Migration/64) and returned by payout_lines_of.
export type PayoutBatch = {
  id: string; payout_no: string | null; store_name: string; dealer_city: string | null;
  order_count: number; line_count: number; total_qty: number; total: number;
  note: string | null; created_by_name: string | null; created_at: string;
};
export type PayoutLine = {
  order_no: string; shipped_at: string | null; withdraw_at: string | null; completed_at: string | null;
  product_id: string | null; product_name: string | null; qty: number; harga_beli: number; total: number;
};
export type SummaryRow = { product_id: string; product_name: string; qty: number; harga_beli: number; total: number };

// Summary sheet / page: one row per product (same Product ID and price), quantities and totals added up.
export function summarize(lines: PayoutLine[]): SummaryRow[] {
  const m = new Map<string, SummaryRow>();
  for (const l of lines) {
    const key = `${l.product_id ?? ""}|${l.harga_beli}`;
    const r = m.get(key) ?? { product_id: l.product_id ?? "", product_name: l.product_name ?? "", qty: 0, harga_beli: Number(l.harga_beli) || 0, total: 0 };
    r.qty += Number(l.qty) || 0;
    r.total += Number(l.total) || 0;
    m.set(key, r);
  }
  return [...m.values()].sort((a, b) => a.product_name.localeCompare(b.product_name) || a.product_id.localeCompare(b.product_id));
}

export const SUMMARY_HEAD = ["ID Product", "Nama Prod", "Qty", "Harga Beli", "Total"] as const;
export const DETAIL_HEAD = ["No Pesanan", "Tgl Kirim", "Tgl Withdraw", "ID Prod", "Nama Prod", "Qty", "Harga Beli", "Total"] as const;

export const dateOrDash = (d: string | null) => (d ? fmtDate(d) : "—");

export function exportFileName(b: PayoutBatch, ext: "xlsx" | "pdf"): string {
  const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
  return `${safe(b.payout_no || "payout")}_${safe(b.store_name)}.${ext}`;
}

// XLSX with two sheets: Summary and Detail. Money / quantity cells are real numbers (thousand separators by format).
export function buildPayoutXlsx(b: PayoutBatch, lines: PayoutLine[]): Buffer {
  const sum = summarize(lines);
  const info = [
    ["Payout", b.payout_no || ""], ["Dealer", b.store_name], ["City", b.dealer_city || ""],
    ["Created", fmtDate(b.created_at.slice(0, 10))],
  ];

  const summaryRows: (string | number)[][] = [
    ...info, [],
    [...SUMMARY_HEAD],
    ...sum.map((r) => [r.product_id, r.product_name, r.qty, r.harga_beli, r.total]),
    ["", "TOTAL", sum.reduce((a, r) => a + r.qty, 0), "", sum.reduce((a, r) => a + r.total, 0)],
  ];
  const detailRows: (string | number)[][] = [
    ...info, [],
    [...DETAIL_HEAD],
    ...lines.map((l) => [l.order_no, l.shipped_at ? fmtDate(l.shipped_at) : "", l.withdraw_at ? fmtDate(l.withdraw_at) : "",
      l.product_id ?? "", l.product_name ?? "", Number(l.qty), Number(l.harga_beli), Number(l.total)]),
    ["", "", "", "", "TOTAL", lines.reduce((a, l) => a + Number(l.qty), 0), "", lines.reduce((a, l) => a + Number(l.total), 0)],
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
  put("Summary", summaryRows, [2, 3, 4], [16, 52, 8, 14, 16]);
  put("Detail", detailRows, [5, 6, 7], [18, 13, 14, 14, 52, 8, 14, 16]);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
