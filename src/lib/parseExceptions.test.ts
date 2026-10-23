import { describe, expect, it } from "vitest";
import { exceptionKindOf, parseExceptionMatrix } from "./parseExceptions";

const RET = ["No. Pengembalian", "No. Pesanan", "Tanggal Pesanan Dibuat", "Nama Produk", "Variasi", "Waktu Pengembalian Diajukan", "Status Pembatalan/ Pengembalian", "Tipe Pengembalian", "Jumlah Produk Dikembalikan", "Alasan Pengembalian", "Total Pengembalian Dana", "Total Pesanan", "Provinsi", "Provinsi"];
const CAN = ["No. Pesanan", "Status Pesanan", "Alasan Pembatalan", "Waktu Pesanan Dibuat", "Nama Produk", "Nama Variasi", "Jumlah", "Subtotal Pesanan", "Total Pembayaran"];
const FAIL = ["No. Pesanan", "Status Pesanan", "Status pengiriman gagal", "Waktu Pesanan Dibuat", "Nama Produk", "Nama Variasi", "Jumlah", "Subtotal Pesanan", "Status Klaim", "Jumlah Kompensasi"];

describe("exception exports", () => {
  it("tells the three files apart by their header", () => {
    expect(exceptionKindOf([RET])).toBe("return");
    expect(exceptionKindOf([CAN])).toBe("cancel");
    expect(exceptionKindOf([FAIL])).toBe("failed");
    expect(exceptionKindOf([["No. Pesanan", "Waktu Pesanan Selesai"]])).toBeNull();
  });

  it("return: one row per return and product, money like RP 2.585.000, filed under the request date", () => {
    const rows = parseExceptionMatrix([RET, ["2610030M9SG4GMX", "260920HB606KWT", "2026-09-20 16:35", "kasa nyamuk", "Putih", "2026-10-03 10:35", "Pengembalian Barang/Dana Dibatalkan", "Seluruh Pesanan", 30, "salah order", "RP 2.585.000\n", "RP 3.100.900\n", "SULTRA", "X"]], "return");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ref_no: "2610030M9SG4GMX", order_no: "260920HB606KWT", qty: 30, amount: 2585000, total_payment: 3100900, year: 2026, month: "Oktober", week: "Week 1", province: "SULTRA" });
    expect(rows[0].row_key).toBe("2610030M9SG4GMX|kasa nyamuk|Putih");
  });

  it("cancel: filed under the order-created date, reason kept", () => {
    const rows = parseExceptionMatrix([CAN, ["A1", "Batal", "Dibatalkan oleh Pembeli. Alasan: x", "2026-09-28 14:51", "screen port", "Hitam", "1", "28.500", "28.500"]], "cancel");
    expect(rows[0]).toMatchObject({ order_no: "A1", status: "Batal", month: "September", week: "Week 4", qty: 1, amount: 28500, ref_no: null });
  });

  it("failed: claim fields go to extra; the same product twice in an order gets distinct keys", () => {
    const line = ["B1", "Batal", "Selesai Dikirim ke Penjual", "2026-09-30 11:03", "engsel", "Brown", "1", "7.990", "", ""];
    const rows = parseExceptionMatrix([FAIL, line, line], "failed");
    expect(rows).toHaveLength(2);
    expect(rows[0].row_key).not.toBe(rows[1].row_key);
    expect(rows[0].status).toBe("Selesai Dikirim ke Penjual");
    expect(rows[0].extra).toMatchObject({ order_status: "Batal", claim_status: null });
  });
});
