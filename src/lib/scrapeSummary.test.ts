import { describe, expect, it } from "vitest";
import { productType, summarize } from "./scrapeSummary";
import type { Cell, ResultData } from "./scrapeResult";

const cell = (o: Partial<Cell>): Cell => ({ ours: 1000, has_link: true, link_id: "L", ok: true, error: null, price: 900, original: null, discount_pct: null, labels: null, scraped_at: null, ...o });

describe("scrape summary", () => {
  it("product type comes from the name", () => {
    expect(productType("Panasonic AC 3/4 PK Deluxe CS/CU-PN7AKJ")).toBe("AC");
    expect(productType("Panasonic 4K LED Google TV [65 Inch]")).toBe("TV");
    expect(productType("Panasonic Mesin Cuci Top Load")).toBe("Washing Machine");
    expect(productType("Something else")).toBe("Other");
  });

  const data: ResultData = {
    columns: [{ id: "A", name: "Shop A", store_name: "A", platform: "Shopee", srp_no: "S" }, { id: "B", name: "Shop B", store_name: "B", platform: "Shopee", srp_no: "S" }],
    rows: [
      { prod_id: "AC1", product_name: "Panasonic AC 1 PK", cells: { A: cell({ price: 800 }), B: cell({ price: 900 }) } },          // A -20%, B -10%
      { prod_id: "TV1", product_name: "Panasonic TV 50", cells: { A: cell({ price: 1200 }), B: cell({ has_link: false }) } },     // A +20%
      { prod_id: "AC2", product_name: "Panasonic AC 2 PK", cells: { A: cell({ price: 950 }), B: cell({ ok: false, price: null, error: "x" }) } }, // A -5%
    ],
  };

  it("tokens = connections; dumping store = lowest average price below ours", () => {
    const s = summarize(data);
    expect(s.tokens).toBe(2);
    expect(s.compared).toBe(4);
    expect([s.cheaper, s.pricier, s.notSold, s.failed]).toEqual([3, 1, 1, 1]);
    expect(s.dumping?.label).toBe("A");        // A: (-20 -5) / 2 = -12.5% on average; B: -10%
    expect(s.dumping?.avgDown).toBeCloseTo(-12.5);
  });

  it("worst product per category and the suggested price change", () => {
    const s = summarize(data);
    const ac = s.types.find((t) => t.type === "AC")!;
    expect(ac.worst?.prod_id).toBe("AC1");
    expect(ac.worst?.pct).toBeCloseTo(-20);
    expect(s.types.find((t) => t.type === "TV")!.worst).toBeNull();
    expect(s.needChange).toBe(2);
    expect(s.changes[0]).toMatchObject({ prod_id: "AC1", price: 800, rp: -200 });
  });
});
