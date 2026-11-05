import { describe, expect, it } from "vitest";
import { diffPct, flatRows, oursOf, verdict, type Cell, type ResultData } from "./scrapeResult";

const cell = (o: Partial<Cell>): Cell => ({ ours: 1000, has_link: true, link_id: "L", ok: true, error: null, price: 900, original: 1000, discount_pct: 10, labels: ["Gratis Ongkir"], scraped_at: null, ...o });

describe("scrape result", () => {
  it("colours: below our price is cheaper (red), above it is more expensive (green)", () => {
    expect(verdict(cell({ price: 900 }))).toBe("cheaper");
    expect(verdict(cell({ price: 1100 }))).toBe("pricier");
    expect(verdict(cell({ price: 1000 }))).toBe("same");
    expect(verdict(cell({ ok: false, price: null, error: "x" }))).toBe("failed");
    expect(verdict(cell({ ok: null, price: null }))).toBe("pending");
    expect(verdict(cell({ has_link: false }))).toBe("none");
    expect(verdict(undefined)).toBe("none");
    expect(diffPct(900, 1000)).toBeCloseTo(-10);
    expect(diffPct(900, null)).toBeNull();
  });

  const data: ResultData = {
    columns: [{ id: "A", store_name: "Panasonic.id", platform: "Shopee", srp_no: "SRP-1" }, { id: "B", store_name: "Panasonic.id", platform: "Tiktok Tokped", srp_no: "SRP-1" }],
    rows: [{ prod_id: "P1", product_name: "AC 1 PK", cells: { A: cell({ ours: 500, price: 450 }), B: cell({ ours: 400, price: 450 }) } },
           { prod_id: "P2", product_name: "Fan", cells: { A: cell({ ours: 500, has_link: false }), B: cell({ ours: 400, ok: false, price: null, error: "blocked" }) } }],
  };

  it("our price: one value, or one per platform when they differ", () => {
    expect(oursOf(data.rows[0], data.columns)).toEqual([{ platform: "Shopee", v: 500 }, { platform: "Tiktok Tokped", v: 400 }]);
    expect(oursOf({ ...data.rows[0], cells: { A: cell({ ours: 500 }), B: cell({ ours: 500 }) } }, data.columns)).toHaveLength(1);
  });

  it("the detail sheet has one line per product x store that has a Product URL", () => {
    const lines = flatRows(data);
    expect(lines).toHaveLength(3);                                                  // P1 x 2, P2 x 1 (the Shopee cell has no link)
    expect(lines[0].slice(6, 12)).toEqual([500, 450, 1000, 10, -10, "Cheaper than us"]);
    expect(lines[1][11]).toBe("More expensive than us");
    expect(lines[2][11]).toBe("Failed");
    expect(lines[2][13]).toBe("blocked");
  });
});
