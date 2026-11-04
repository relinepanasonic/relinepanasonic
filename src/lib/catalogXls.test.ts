import { describe, expect, it } from "vitest";
import { CATALOG_EXAMPLE, CATALOG_HEADER, parseCatalogMatrix, parsePrice } from "./catalogXls";

describe("product catalog XLS", () => {
  it("reads prices written in any Indonesian or English way", () => {
    expect(parsePrice("Rp 7.500.000")).toBe(7500000);
    expect(parsePrice("7,500,000")).toBe(7500000);
    expect(parsePrice(7500000)).toBe(7500000);
    expect(parsePrice("12,5")).toBe(12.5);
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("-")).toBeNull();
  });

  it("the template round-trips: header + the example row", () => {
    const { rows, skipped, error } = parseCatalogMatrix([[...CATALOG_HEADER], CATALOG_EXAMPLE]);
    expect(error).toBeUndefined();
    expect(skipped).toEqual([]);
    expect(rows).toEqual([{ prod_id: "9078737678", product_name: "AC Panasonic 2 PK CS-YN18AKJ", harga_beli: 5800000, harga_srp: 7500000 }]);
  });

  it("finds the header below a title, skips empty / incomplete / duplicate rows and reports their sheet row number", () => {
    const m = [["Katalog"], [], ["Produk", "Product ID", "Harga SRP", "Modal Produk"],
      ["AC A", "P1", "Rp 4.000.000", "Rp 3.000.000"], ["", "", "", ""], ["AC B", "", 5, 1], ["AC A again", "P1", 1, 1], ["Fan", "P3", "", ""]];
    const { rows, skipped } = parseCatalogMatrix(m);
    expect(rows.map((r) => r.prod_id)).toEqual(["P1", "P3"]);
    expect(rows[0]).toMatchObject({ harga_srp: 4000000, harga_beli: 3000000 });
    expect(rows[1]).toMatchObject({ harga_srp: null, harga_beli: null });
    expect(skipped.map((s) => s.row)).toEqual([6, 7]);
  });

  it("says so when it is not the template", () => {
    expect(parseCatalogMatrix([["a", "b"], [1, 2]]).error).toMatch(/Header row not found/);
  });
});
