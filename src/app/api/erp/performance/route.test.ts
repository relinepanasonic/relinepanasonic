import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const zeroAds = { cost: 0, sales: 0, views: 0, clicks: 0, addToCart: 0, orders: 0, itemsSold: 0 };
const mk = (store: string, start: string, extra: Record<string, unknown> = {}) => ({
  store, periodStart: start, periodEnd: start, granularity: "week", sales: 100, gmv: 500, traffic: 10, addToCart: 2, orders: 1, itemsSold: 3,
  productViews: 20, productClicks: 4, baselineSales: 50, activeSales: 100,
  ads: { gmvMax: { ...zeroAds, cost: 5 }, group: { ...zeroAds }, independent: { ...zeroAds } }, ...extra,
});

let bySchema: Record<string, unknown[]> = {};
let refreshed: string[] = [];
let calls: { schema: string; from: string; to: string }[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (schema = "public") => ({
    rpc: async (fn: string, args?: { p_from: string; p_to: string }) => {
      if (fn === "erp_perf_refresh_if_stale") { refreshed.push(schema); return { data: false, error: null }; }
      calls.push({ schema, from: args!.p_from, to: args!.p_to });
      return { data: bySchema[schema] ?? [], error: null };
    },
  }),
}));

const KEY = "test-only-key-do-not-use-in-prod";
const req = (qs: string, key?: string) =>
  new NextRequest(new URL("/api/erp/performance" + qs, "http://localhost"), { headers: key ? { authorization: `Bearer ${key}` } : {} });
const OK = "?from=2026-09-01&to=2026-09-30";

describe("GET /api/erp/performance", () => {
  beforeEach(() => { process.env.ERP_API_KEY = KEY; bySchema = {}; refreshed = []; calls = []; });

  it("401s with no key, a wrong key, a key in the query string, or an unset env var, with an empty body", async () => {
    const { GET } = await import("./route");
    for (const r of [await GET(req(OK)), await GET(req(OK, "wrong")), await GET(req(OK + "&key=" + KEY))]) { expect(r.status).toBe(401); expect(await r.text()).toBe(""); }
    delete process.env.ERP_API_KEY;
    expect((await GET(req(OK, KEY))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("400s for missing or invalid dates and for a range over 370 days; exactly 370 days is accepted", async () => {
    const { GET } = await import("./route");
    for (const qs of ["", "?from=2026-09-01", "?from=2026-02-30&to=2026-03-01", "?from=2026-09-30&to=2026-09-01", "?from=2025-01-01&to=2026-06-01"]) {
      expect((await GET(req(qs, KEY))).status).toBe(400);
    }
    expect((await GET(req("?from=2025-10-01&to=2026-10-05", KEY))).status).toBe(200);   // 370 days
    expect((await GET(req("?from=2025-10-01&to=2026-10-06", KEY))).status).toBe(400);   // 371 days
  });

  it("returns the shape with a row from every workspace, sorted, with the workspace name; a workspace with no data adds nothing", async () => {
    bySchema = { public: [mk("Toko B", "2026-09-14"), mk("Toko A", "2026-09-07")], ws_alpha: [mk("Alpha Shop", "2026-09-07")] };   // ws_light: nothing
    const { GET } = await import("./route");
    const res = await GET(req(OK, KEY));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const j = await res.json();
    expect(j.timezone).toBe("Asia/Jakarta");
    expect(typeof j.generatedAt).toBe("string");
    expect(j.rows.map((r: { store: string }) => r.store)).toEqual(["Alpha Shop", "Toko A", "Toko B"]);
    expect(j.rows[0]).toMatchObject({ workspace: "Alpha Project", periodStart: "2026-09-07", granularity: "week", sales: 100, gmv: 500, traffic: 10, addToCart: 2, orders: 1, itemsSold: 3,
      productViews: 20, productClicks: 4, baselineSales: 50, activeSales: 100 });
    expect(Object.keys(j.rows[0].ads)).toEqual(["gmvMax", "group", "independent"]);
    expect(Object.keys(j.rows[0].ads.gmvMax)).toEqual(["cost", "sales", "views", "clicks", "addToCart", "orders", "itemsSold"]);
    expect(j.rows.filter((r: { workspace: string }) => r.workspace === "Panasonic Light Solution")).toHaveLength(0);
    expect(refreshed.sort()).toEqual(["public", "ws_alpha", "ws_light"]);                           // the cache is checked in every workspace
    expect(calls.every((c) => c.from === "2026-09-01" && c.to === "2026-09-30")).toBe(true);
  });

  it("never returns a negative or non-numeric value", async () => {
    bySchema = { public: [mk("Toko A", "2026-09-07", { sales: -5, gmv: "x", ads: { gmvMax: { ...zeroAds, sales: -77600000 }, group: zeroAds, independent: { ...zeroAds, cost: -1 } } })] };
    const { GET } = await import("./route");
    const j = await (await GET(req(OK, KEY))).json();
    const neg = (o: unknown): boolean => typeof o === "number" ? o < 0 || !Number.isFinite(o) : o && typeof o === "object" ? Object.values(o).some(neg) : false;
    expect(neg(j.rows)).toBe(false);
    expect(j.rows[0].sales).toBe(0);
    expect(j.rows[0].ads.gmvMax.sales).toBe(0);
  });
});
