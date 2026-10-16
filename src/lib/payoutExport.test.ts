import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { renderToBuffer } from "@react-pdf/renderer";
import { buildPayoutXlsx, exportFileName, summarize, type PayoutBatch, type PayoutLine } from "./payoutExport";
import { PayoutDocument } from "./payoutPdf";

const batch: PayoutBatch = {
  id: "b1", payout_no: "PO-2610-0001", store_name: "Nicotest", dealer_city: "Great Jakarta 1",
  order_count: 2, line_count: 3, total_qty: 9, total: 21500, note: null, created_by_name: "Admin", created_at: "2026-10-16T08:00:00Z",
};
const lines: PayoutLine[] = [
  { order_no: "A1", shipped_at: "2026-08-20", withdraw_at: "2026-09-02", completed_at: "2026-08-25", product_id: "P1", product_name: "Kasa nyamuk fiber", qty: 3, harga_beli: 1000, total: 3000 },
  { order_no: "A2", shipped_at: null, withdraw_at: null, completed_at: "2026-08-26", product_id: "P1", product_name: "Kasa nyamuk fiber", qty: 2, harga_beli: 1000, total: 2000 },
  { order_no: "A2", shipped_at: null, withdraw_at: null, completed_at: "2026-08-26", product_id: "P2", product_name: "Sudut plastik", qty: 4, harga_beli: 4125, total: 16500 },
];

describe("payout export", () => {
  it("summary adds quantities and totals per product", () => {
    const s = summarize(lines);
    expect(s).toHaveLength(2);
    expect(s.find((r) => r.product_id === "P1")).toMatchObject({ qty: 5, harga_beli: 1000, total: 5000 });
    expect(s.reduce((a, r) => a + r.total, 0)).toBe(21500);
  });

  it("the XLSX has the two tabs with the requested columns and numeric money cells", () => {
    const wb = XLSX.read(buildPayoutXlsx(batch, lines), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Summary", "Detail"]);
    const sum = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Summary, { header: 1 });
    const det = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Detail, { header: 1 });
    expect(sum.find((r) => r[0] === "ID Product")).toEqual(["ID Product", "Nama Prod", "Qty", "Harga Beli", "Total"]);
    expect(det.find((r) => r[0] === "No Pesanan")).toEqual(["No Pesanan", "Tgl Kirim", "Tgl Withdraw", "ID Prod", "Nama Prod", "Qty", "Harga Beli", "Total"]);
    const p2 = sum.find((r) => r[0] === "P2");
    expect(p2).toEqual(["P2", "Sudut plastik", 4, 4125, 16500]);
    expect(sum[sum.length - 1][4]).toBe(21500);
    expect(det[det.length - 1][7]).toBe(21500);
    expect(det.filter((r) => r[0] === "A1" || r[0] === "A2")).toHaveLength(3); // one row per order line
  });

  it("the PDF renders (Summary page + Detail page)", async () => {
    const buf = await renderToBuffer(PayoutDocument({ batch, lines }));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5000);
    expect((buf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("file names are safe", () => {
    expect(exportFileName(batch, "xlsx")).toBe("PO-2610-0001_Nicotest.xlsx");
    expect(exportFileName({ ...batch, store_name: "Toko A/B Jaya" }, "pdf")).toBe("PO-2610-0001_Toko_A_B_Jaya.pdf");
  });
});
