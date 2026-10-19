import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildPayoutXlsx, exportFileName, summarize, type PayoutBatch, type PayoutLine } from "./payoutExport";
import { buildPayoutPdf } from "./payoutPdfClient";

const batch: PayoutBatch = {
  id: "b1", payout_no: "PO-2610-0001", vendor_name: "Vendor One", store_name: "Nicotest, Toko B", dealer_city: null,
  order_count: 2, line_count: 4, total_qty: 12, total: 24000, note: null, created_by_name: "Admin", created_at: "2026-10-16T08:00:00Z",
};
const L = (o: Partial<PayoutLine>): PayoutLine => ({
  store_name: "Nicotest", order_no: "A1", shipped_at: null, withdraw_at: null, completed_at: "2026-08-25", product_id: "P1", product_name: "Kasa nyamuk fiber",
  variant_id: "-", variant_name: "-", qty: 1, harga_beli: 1000, total: 1000, ...o,
});
const lines: PayoutLine[] = [
  L({ order_no: "A1", shipped_at: "2026-08-20", withdraw_at: "2026-09-02", variant_id: "V1", variant_name: "Hitam", qty: 3, harga_beli: 2000, total: 6000 }),
  L({ order_no: "A2", store_name: "Toko B", variant_id: "V1", variant_name: "Hitam", qty: 2, harga_beli: 2000, total: 4000 }),
  L({ order_no: "A2", store_name: "Toko B", variant_id: "V2", variant_name: "Putih", qty: 3, harga_beli: 1000, total: 3000 }),
  L({ order_no: "A2", store_name: "Toko B", product_id: "P2", product_name: "Sudut plastik", qty: 4, harga_beli: 2750, total: 11000 }),
];

describe("payout export", () => {
  it("summary adds quantities and totals per product + variant + price (stores of the vendor together)", () => {
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

  it("the XLSX has the two tabs with the requested columns (plus store and variant) and numeric money cells", () => {
    const wb = XLSX.read(buildPayoutXlsx(batch, lines), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Summary", "Detail"]);
    const sum = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Summary, { header: 1 });
    const det = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Detail, { header: 1 });
    expect(sum.find((r) => r[0] === "ID Product")).toEqual(["ID Product", "Nama Prod", "ID Variasi", "Variasi", "Qty", "Harga Beli", "PPN (11%)", "Total"]);
    expect(det.find((r) => r[0] === "No Pesanan")).toEqual(["No Pesanan", "Store", "Tgl Kirim", "Tgl Withdraw", "ID Prod", "Nama Prod", "ID Variasi", "Variasi", "Qty", "Harga Beli", "PPN (11%)", "Total"]);
    expect(sum.find((r) => r[0] === "P2")).toEqual(["P2", "Sudut plastik", "-", "-", 4, 2750, 1090, 11000]); // 11000 - 11000/1.11 = 1090
    expect(sum[sum.length - 1][7]).toBe(24000);
    expect(det[det.length - 1][11]).toBe(24000);
    expect(det.find((r) => r[0] === "A1")?.[10]).toBe(595); // 6000 - 6000/1.11
    expect(det.filter((r) => r[0] === "A1" || r[0] === "A2")).toHaveLength(4); // one row per order line
    expect(sum.find((r) => r[0] === "Vendor")).toEqual(["Vendor", "Vendor One"]);
  });

  it("the browser PDF: Summary page + Detail page(s), and a long payout stays fast", () => {
    const doc = buildPayoutPdf(batch, lines);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(3000);
    const many = Array.from({ length: 1500 }, (_, i) => L({ order_no: `X${i}`, product_id: `P${i % 40}`, product_name: `Product number ${i % 40}`, qty: 2, total: 2000 }));
    const t0 = Date.now();
    const big = buildPayoutPdf({ ...batch, line_count: 1500 }, many);
    expect(big.getNumberOfPages()).toBeGreaterThan(10);
    expect(Date.now() - t0).toBeLessThan(15000);
  }, 30000);

  it("file names are safe", () => {
    expect(exportFileName(batch, "xlsx")).toBe("PO-2610-0001_Vendor_One.xlsx");
    expect(exportFileName({ ...batch, vendor_name: "Toko A/B Jaya" }, "pdf")).toBe("PO-2610-0001_Toko_A_B_Jaya.pdf");
  });
});
