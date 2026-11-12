import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let bySchema: Record<string, unknown[]> = {};
let calls: { schema: string; from: string; to: string; limit: number }[] = [];
let failSchema: string | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (schema = "public") => ({
    rpc: async (_fn: string, args: { p_from: string; p_to: string; p_limit: number }) => {
      calls.push({ schema, from: args.p_from, to: args.p_to, limit: args.p_limit });
      if (failSchema === schema) return { data: null, error: { message: "boom" } };
      return { data: bySchema[schema] ?? [], error: null };
    },
  }),
}));

const KEY = "test-only-key-do-not-use-in-prod";
const req = (qs: string, key?: string) =>
  new NextRequest(new URL("/api/erp/top-products" + qs, "http://localhost"), { headers: key ? { authorization: `Bearer ${key}` } : {} });
const OK = "?from=2026-11-02&to=2026-11-08";
const block = (store: string, products: { name: string; sales: number }[]) => ({ store, products });

describe("GET /api/erp/top-products", () => {
  beforeEach(() => { process.env.ERP_API_KEY = KEY; bySchema = {}; calls = []; failSchema = null; });

  it("401s with no key, a wrong key, a key in the query string, or an unset env var, with an empty body, before any query", async () => {
    const { GET } = await import("./route");
    for (const r of [await GET(req(OK)), await GET(req(OK, "wrong")), await GET(req(OK + "&key=" + KEY))]) { expect(r.status).toBe(401); expect(await r.text()).toBe(""); expect(r.headers.get("cache-control")).toBe("no-store"); }
    delete process.env.ERP_API_KEY;
    expect((await GET(req(OK, KEY))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("400s for missing or invalid dates, a range over 62 days (exactly 62 is accepted), and a bad limit", async () => {
    const { GET } = await import("./route");
    for (const qs of ["", "?from=2026-11-02", "?from=2026-11-02&to=nope", "?from=2026-02-30&to=2026-03-02", "?from=2026-11-09&to=2026-11-02"]) expect((await GET(req(qs, KEY))).status).toBe(400);
    expect((await GET(req("?from=2026-09-01&to=2026-11-02", KEY))).status).toBe(400);   // 63 days
    expect((await GET(req("?from=2026-09-01&to=2026-11-01", KEY))).status).toBe(200);   // 62 days
    for (const l of ["0", "21", "-1", "abc", "1.5", ""]) expect((await GET(req(OK + "&limit=" + l, KEY))).status).toBe(400);
    expect((await GET(req(OK + "&limit=20", KEY))).status).toBe(200);
  });

  it("200 with the documented shape: workspace names, sorted products, plain numbers, no CORS, no-store", async () => {
    bySchema = {
      public: [block("Sumber Multi - Cinere", [{ name: " B product ", sales: 100 }, { name: "A product", sales: 500 }, { name: "C product", sales: 100 }])],
      ws_alpha: [block("Store X", [{ name: "Only", sales: 7 }])],
    };
    const { GET } = await import("./route");
    const r = await GET(req(OK + "&limit=3", KEY));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    const j = await r.json();
    expect(Object.keys(j).sort()).toEqual(["from", "generatedAt", "stores", "timezone", "to"]);
    expect([j.timezone, j.from, j.to]).toEqual(["Asia/Jakarta", "2026-11-02", "2026-11-08"]);
    expect(j.stores).toEqual([
      { store: "Store X", workspace: "Alpha Project", products: [{ name: "Only", sales: 7 }] },
      { store: "Sumber Multi - Cinere", workspace: "Reline Project 1.0", products: [{ name: "A product", sales: 500 }, { name: "B product", sales: 100 }, { name: "C product", sales: 100 }] },
    ]);
    expect(calls.map((c) => c.schema).sort()).toEqual(["public", "ws_alpha", "ws_light"]);
    expect(calls.every((c) => c.from === "2026-11-02" && c.to === "2026-11-08" && c.limit === 3)).toBe(true);
  });

  it("defaults to 10 products; a store without sales is not listed; zero, negative and nameless products are dropped; at most `limit` per store", async () => {
    bySchema = {
      public: [
        block("Has sales", Array.from({ length: 15 }, (_, i) => ({ name: `P${String(i).padStart(2, "0")}`, sales: 1000 - i }))),
        block("No sales", []),
        block("Only junk", [{ name: "Zero", sales: 0 }, { name: "Neg", sales: -5 }, { name: "  ", sales: 9 }]),
      ],
    };
    const { GET } = await import("./route");
    const j = await (await GET(req(OK, KEY))).json();
    expect(calls[0].limit).toBe(10);
    expect(j.stores).toHaveLength(1);
    expect(j.stores[0].store).toBe("Has sales");
    expect(j.stores[0].products).toHaveLength(10);
    const sales = j.stores[0].products.map((p: { sales: number }) => p.sales);
    expect([...sales].sort((a, b) => b - a)).toEqual(sales);
    expect(sales.every((s: number) => s > 0)).toBe(true);
  });

  it("an empty answer is 200 with no stores; a failing query is a 500 without details", async () => {
    const { GET } = await import("./route");
    const empty = await GET(req(OK, KEY));
    expect(empty.status).toBe(200);
    expect((await empty.json()).stores).toEqual([]);
    failSchema = "ws_alpha";
    const r = await GET(req(OK, KEY));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "query failed" });
  });
});
