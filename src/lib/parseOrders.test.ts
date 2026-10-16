import { describe, expect, it } from "vitest";
import { isOrdersHeader, parseOrdersMatrix } from "./parseOrders";

const HEAD = ["No. Pesanan", "Waktu Pesanan Dibuat", "Waktu Pengiriman Diatur", "Nama Produk", "Jumlah", "Total Pembayaran", "Waktu Pesanan Selesai"];

describe("parseOrdersMatrix", () => {
  it("reads the ship time of an Order.shipping export (completed time stays empty)", () => {
    const rows = parseOrdersMatrix([HEAD, ["A1", "2026-10-15 08:46", "2026-10-15 09:01", "engsel", "1", "11.631", ""]]);
    expect(rows).toHaveLength(1);
    expect(rows[0].shipped_at).toBe("2026-10-15 09:01");
    expect(rows[0].completed_at).toBeNull();
  });

  it("has no ship time for an Order.completed export", () => {
    const head = HEAD.filter((h) => h !== "Waktu Pengiriman Diatur");
    const rows = parseOrdersMatrix([head, ["A1", "2026-06-02 05:24", "engsel", "1", "11.631", "2026-06-02 18:06"]]);
    expect(rows[0].shipped_at).toBeNull();
    expect(rows[0].completed_at).toBe("2026-06-02 18:06");
  });

  it("a header-only file is a valid export with no orders", () => {
    expect(isOrdersHeader([HEAD])).toBe(true);
    expect(parseOrdersMatrix([HEAD])).toEqual([]);
    expect(isOrdersHeader([["Foo", "Bar"]])).toBe(false);
  });
});
