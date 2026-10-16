import { describe, expect, it } from "vitest";
import { parseProductList } from "./parseProductList";

const HEAD = ["PIC", "Dealer", "Kode Produk", "Produk", "Kode Variasi", "Nama Variasi"];

describe("parseProductList", () => {
  it("one entry per product + variant, repeated rows (weeks, dealers) are merged", () => {
    const m = [HEAD,
      ["a", "D1", 29226651224, "Kulkas A", "-", "-"],
      ["a", "D2", 29226651224, "Kulkas A", "-", "-"],
      ["a", "D1", 27126537283, "Kulkas B", 237386000123, "Hitam"],
      ["a", "D1", 27126537283, "Kulkas B", 237386000124, "Putih"],
      ["a", "D1", 27126537283, "Kulkas B", 237386000124, "Putih"]];
    const p = parseProductList(m);
    expect(p.rows).toHaveLength(3);
    expect(p.rows[1]).toEqual({ kode_produk: "27126537283", nama_produk: "Kulkas B", kode_variasi: "237386000123", nama_variasi: "Hitam" });
    expect(p.lossy).toBe(0);
  });

  it("numbers keep every digit; text IDs are kept as typed", () => {
    const p = parseProductList([HEAD, ["a", "D", "29226651224", "X", "-", "-"], ["a", "D", 40400289177, "Y", "-", "-"]]);
    expect(p.rows.map((r) => r.kode_produk)).toEqual(["29226651224", "40400289177"]);
  });

  it("warns about IDs that were already damaged into scientific notation", () => {
    const p = parseProductList([HEAD, ["a", "D", "27126537283", "Kulkas", "2.37386E+11", "Hitam"]]);
    expect(p.lossy).toBe(1);
  });

  it("rows without a product code are ignored; a file without the header gives nothing", () => {
    expect(parseProductList([HEAD, ["a", "D", "-", "x", "-", "-"], ["a", "D", "", "y", "-", "-"]]).rows).toEqual([]);
    expect(parseProductList([["Foo", "Bar"], [1, 2]]).rows).toEqual([]);
  });

  it("works when the header is not on the first row", () => {
    const p = parseProductList([["report"], [], HEAD, ["a", "D", 111, "P", "-", "-"]]);
    expect(p.rows).toHaveLength(1);
  });
});
