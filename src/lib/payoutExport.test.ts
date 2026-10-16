import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { renderToBuffer } from "@react-pdf/renderer";
import { buildPayoutXlsx, exportFileName, summarize, type PayoutBatch, type PayoutLine } from "./payoutExport";
import { PayoutDocument } from "./payoutPdf";

const batch: PayoutBatch = {
  id: "b1", payout_no: "PO-2610-0001", store_name: "Nicotest", dealer_city: "Great Jakarta 1",
  order_count: 2, line_count: 4, total_qty: 12, total: 24000, note: null, created_by_name: "Admin", created_at: "2026-10-16T08:00:00Z",
};
const L = (o: Partial<PayoutLine>): PayoutLine => ({
  order_no: "A1", shipped_at: null, withdraw_at: null, completed_at: "2026-08-25", product_id: "P1", product_name: "Kasa nyamuk fiber",
  variant_id: "-", variant_name: "-", qty: 1, harga_beli: 1000, total: 1000, ...o,
});
const lines: PayoutLine[] = [
  L({ order_no: "A1", shipped_at: "2026-08-20", withdraw_at: "2026-09-02", variant_id: "V1", variant_name: "Hitam", qty: 3, harga_beli: 2000, total: 6000 }),
  L({ order_no: "A2", variant_id: "V1", variant_name: "Hitam", qty: 2, harga_beli: 2000, total: 4000 }),
  L({ order_no: "A2", variant_id: "V2", variant_name: "Putih", qty: 3, harga_beli: 1000, total: 3000 }),
  L({ order_no: "A2", product_id: "P2", product_name: "Sudut plastik", qty: 4, harga_beli: 2750, total: 11000 }),
];

describe("payout export", () => {
  it("summary adds quantities and totals per product + variant + price", () => {
    const s = summarize(lines);
    expect(s).toHaveLength(3);
    expect(s.find((r) => r.variant_id === "V1")).toMatchObject({ qty: 5, harga_beli: 2000, total: 10000 });
    expect(s.find((r) => r.variant_id === "V2")).toMatchObject({ qty: 3, harga_beli: 1000, total: 3000 });
    expect(s.reduce((a, r) => a + r.total, 0)).toBe(24000);
  });

  it("the same variant at two prices stays on two rows", () => {
    const s = summarize([L({ variant_id: "V1", variant_name: "Hitam", harga_beli: 2000, total: 2000 }), L({ variant_id: "V1", variant_name: "Hitam", harga_beli: 2500, total: 2500 })]);
    expect(s).toHaveLength(2);
  });

  it("the XLSX has the two tabs with the requested columns (plus the variant) and numeric money cells", () => {
    const wb = XLSX.read(buildPayoutXlsx(batch, lines), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Summary", "Detail"]);
    const sum = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Summary, { header: 1 });
    const det = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Detail, { header: 1 });
    expect(sum.find((r) => r[0] === "ID Product")).toEqual(["ID Product", "Nama Prod", "ID Variasi", "Variasi", "Qty", "Harga Beli", "Total"]);
    expect(det.find((r) => r[0] === "No Pesanan")).toEqual(["No Pesanan", "Tgl Kirim", "Tgl Withdraw", "ID Prod", "Nama Prod", "ID Variasi", "Variasi", "Qty", "Harga Beli", "Total"]);
    expect(sum.find((r) => r[0] === "P2")).toEqual(["P2", "Sudut plastik", "-", "-", 4, 2750, 11000]);
    expect(sum[sum.length - 1][6]).toBe(24000);
    expect(det[det.length - 1][9]).toBe(24000);
    expect(det.filter((r) => r[0] === "A1" || r[0] === "A2")).toHaveLength(4); // one row per order line
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
