import { describe, expect, it } from "vitest";
import { CATALOG_EXAMPLE, CATALOG_HEADER, parseCatalogMatrix, parsePrice } from "./catalogXls";
import { CALC_EXAMPLE, CALC_HEADER, feeKeyOf, isFlatTemplate, parseCalcMatrix } from "./calcTemplate";

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
    expect(rows).toEqual([{ prod_id: "9078737678", product_name: "AC Panasonic 2 PK CS-YN18AKJ", srp_id: "SRP-2026-10", price_srp: 7500000 }]);
  });

  it("finds the header below a title, skips empty / incomplete / duplicate rows and reports their sheet row number", () => {
    const m = [["Katalog"], [], ["Produk", "Product ID", "SRP", "SRP ID"],
      ["AC A", "P1", "Rp 4.000.000", "S1"], ["", "", "", ""], ["AC B", "", 5, "S1"], ["AC A again", "P1", 1, "S1"], ["Fan", "P3", "", ""]];
    const { rows, skipped } = parseCatalogMatrix(m);
    expect(rows.map((r) => r.prod_id)).toEqual(["P1", "P3"]);
    expect(rows[0]).toMatchObject({ srp_id: "S1", price_srp: 4000000 });
    expect(rows[1]).toMatchObject({ srp_id: null, price_srp: null });
    expect(skipped.map((s) => s.row)).toEqual([6, 7]);
  });

  it("says so when it is not the template", () => {
    expect(parseCatalogMatrix([["a", "b"], [1, 2]]).error).toMatch(/Header row not found/);
  });
});

describe("Massive Calculator XLS", () => {
  const catalog = new Map([["9078737678", { name: "AC Panasonic 2 PK CS-YN18AKJ", srp: 7500000 }], ["P2", { name: "Fan", srp: null }]]);
  const fees = [{ id: "F1", category: "Elektronik", sub_category: "AC", jenis_product: "AC Split", platform: "Shopee", jenis_toko: "Star" }];

  it("the template example is recognised and linked to its fee row, Harga Jual empty = the SRP", () => {
    const m = [[...CALC_HEADER], CALC_EXAMPLE];
    expect(isFlatTemplate(m)).toBe(true);
    const r = parseCalcMatrix(m, catalog, fees);
    expect(r.error).toBeUndefined();
    expect(r.matched).toBe(1);
    expect(r.rows[0]).toMatchObject({ prod_id: "9078737678", item_product: "AC Panasonic 2 PK CS-YN18AKJ", modal_produk_rp: 5800000, harga_jual_rp: 7500000, fee_id: "F1",
      target_roas: 8, berat_kg: 28, ukuran_cm3: 52000, gratis_ongkir_on: true, promo_xtra_on: true, paylater_3mo_on: false, biaya_lain_rp: 0 });
  });

  it("an explicit Harga Jual wins, a fee that does not exist stays unlinked, and the bad rows are reported", () => {
    const m = [[...CALC_HEADER],
      [1, "9078737678", "", 5800000, "Rp 7.200.000", "Shopee", "Star", "Elektronik", "AC", "AC Split", 5, 10, 1000, "No", "No", "Yes", "Yes", 15000],
      [2, "9078737678", "", 5800000, "", "Tiktok", "Regular", "x", "y", "z", 0, 0, 0, "", "", "", "", ""],
      [3, "NOPE", "", 1, 1, "Shopee", "Star", "", "", "", 0, 0, 0, "", "", "", "", ""],
      [4, "9078737678", "", 1, 1, "Shopee", "Star", "", "", "", 0, 0, 0, "", "", "", "", ""],   // same product + platform + toko as row 1
    ];
    const r = parseCalcMatrix(m, catalog, fees);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ harga_jual_rp: 7200000, gratis_ongkir_on: false, promo_xtra_on: false, paylater_3mo_on: true, paylater_6mo_on: true, biaya_lain_rp: 15000, fee_id: "F1" });
    expect(r.rows[1].fee_id).toBeNull();
    expect(r.matched).toBe(1); expect(r.unmatched).toBe(1);
    expect(r.skipped.map((s) => s.row)).toEqual([4, 5]);
    expect(r.skipped[0].reason).toMatch(/not in the Product Catalog/);
    expect(r.skipped[1].reason).toMatch(/twice/);
  });

  it("the old 3-row-header layout is not the flat template", () => {
    expect(isFlatTemplate([["Item Product", "Platform", "Modal Produk"]])).toBe(false);
  });

  it("fee keys ignore case and spaces", () => {
    expect(feeKeyOf({ category: " Elektronik ", sub_category: "ac", jenis_product: "AC Split", platform: "SHOPEE", jenis_toko: "star" })).toBe("elektronik|ac|ac split|shopee|star");
  });
});
