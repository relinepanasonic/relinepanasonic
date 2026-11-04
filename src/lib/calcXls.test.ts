import { describe, expect, it } from "vitest";
import { CALC_HEADER, feeKeyOf, lineKeyOf, parseCalcXls } from "./calcXls";

describe("Perhitungan Harga XLS", () => {
  const head = [...CALC_HEADER];
  const line = [1, "P1", "AC 1 PK", 5800000, "Rp 7.500.000", "Shopee", "Star", "Elektronik", "AC", "AC Split", "RAC", 8, 28, 52000, "Yes", "No", "No", "Yes", 15000, 111, 222];

  it("reads a line: prices in any format, Yes/No cells, the fee row parts", () => {
    const r = parseCalcXls([head, line]);
    expect(r.error).toBeUndefined();
    expect(r.rows[0]).toMatchObject({ prod_id: "P1", item_product: "AC 1 PK", modal_produk_rp: 5800000, harga_jual_rp: 7500000, platform: "Shopee", toko: "Star",
      product_line: "RAC", target_roas: 8, berat_kg: 28, ukuran_cm3: 52000, gratis_ongkir_on: true, promo_xtra_on: false, paylater_6mo_on: true, biaya_lain_rp: 15000 });
    expect(r.rows[0].fee).toEqual({ category: "Elektronik", sub_category: "AC", jenis_product: "AC Split", platform: "Shopee", jenis_toko: "Star" });
  });

  it("an empty cell stays undefined, so an update leaves that value alone", () => {
    const r = parseCalcXls([head, [2, "P2", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]);
    expect(r.rows[0].modal_produk_rp).toBeUndefined();
    expect(r.rows[0].harga_jual_rp).toBeUndefined();
    expect(r.rows[0].gratis_ongkir_on).toBeUndefined();
    expect(r.rows[0].fee).toBeUndefined();
  });

  it("finds the header below a title and reports empty / duplicate rows with their sheet row number", () => {
    const r = parseCalcXls([["Title"], head, line, ["", "", ""], [3, "", "x"], line.slice()]);
    expect(r.rows).toHaveLength(1);
    expect(r.skipped.map((s) => s.row)).toEqual([5, 6]);
    expect(r.skipped[1].reason).toMatch(/twice/);
  });

  it("says so when it is not the sheet", () => {
    expect(parseCalcXls([["a", "b"], [1, 2]]).error).toMatch(/Header row not found/);
  });

  it("keys ignore case and spaces", () => {
    expect(feeKeyOf({ category: " Elektronik ", sub_category: "ac", jenis_product: "AC Split", platform: "SHOPEE", jenis_toko: "star" })).toBe("elektronik|ac|ac split|shopee|star");
    expect(lineKeyOf(" P1 ", "Shopee", "STAR")).toBe("P1|shopee|star");
  });
});
