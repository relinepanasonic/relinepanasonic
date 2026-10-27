import { describe, it, expect, vi, beforeEach } from "vitest";

let runs: Record<string, unknown>[] = [];
let links: Record<string, unknown>[] = [];
let snaps: Record<string, unknown>[] = [];
let updates: { id: unknown; patch: Record<string, unknown> }[] = [];

function chain(result: () => unknown) {
  const b: Record<string, unknown> = {
    select: () => b, in: () => b, or: () => b, order: () => b, limit: () => b,
    insert: async (rows: Record<string, unknown> | Record<string, unknown>[]) => { snaps.push(...(Array.isArray(rows) ? rows : [rows])); return { error: null }; },
    update: (patch: Record<string, unknown>) => ({ eq: async (_c: string, id: unknown) => { updates.push({ id, patch }); return { error: null }; } }),
    then: (resolve: (v: unknown) => void) => resolve(result()),
  };
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: "superadmin" } }) }) }) }),
  }),
}));
vi.mock("@/lib/workspace-server", () => ({ currentSchema: async () => "public" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => t === "price_research_runs" ? chain(() => ({ data: runs })) : t === "price_research_links" ? chain(() => ({ data: links })) : chain(() => ({ error: null })),
  }),
}));

const apify = (status: string, items: unknown[] = []) => vi.fn(async (url: string) => {
  if (String(url).includes("/datasets/")) return new Response(JSON.stringify(items), { status: 200 });
  return new Response(JSON.stringify({ data: { status, defaultDatasetId: "ds1", statusMessage: "boom" } }), { status: 200 });
});
const run = (over: Record<string, unknown> = {}) => ({ id: "R1", client_id: "C", platform: "tokopedia", apify_run_id: "a1", dataset_id: "ds1", link_ids: ["L1", "L2"], status: "running", started_at: new Date().toISOString(), ...over });

describe("GET /api/price-research/runs", () => {
  beforeEach(() => {
    process.env.APIFY_TOKEN = "t"; snaps = []; updates = [];
    runs = [run()];
    links = [
      { id: "L1", client_id: "C", platform: "tokopedia", product_url: "https://www.tokopedia.com/rival/ac-1pk" },
      { id: "L2", client_id: "C", platform: "tokopedia", product_url: "https://www.tokopedia.com/rival/gone" },
    ];
  });

  it("a finished Apify run saves a snapshot per link (a missing result is a failed one) and closes the run", async () => {
    vi.stubGlobal("fetch", apify("SUCCEEDED", [{ url: "https://www.tokopedia.com/rival/ac-1pk", priceInt: 3500000, name: "AC", shopName: "Rival" }]));
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(snaps.find((s) => s.link_id === "L1")).toMatchObject({ ok: true, price: 3500000, title: "AC", shop_name: "Rival", run_id: "a1" });
    expect(snaps.find((s) => s.link_id === "L2")).toMatchObject({ ok: false });
    expect(updates[0]).toMatchObject({ id: "R1", patch: { status: "done", scraped: 1, failed: 1 } });
    vi.unstubAllGlobals();
  });

  it("an Apify run that succeeded with 0 results says why (log hint, no cookie value, cookie note)", async () => {
    runs = [run({ platform: "shopee" })];
    process.env.APIFY_SHOPEE_COOKIE = "SPC_R_T_IV=1; SPC_SI=2";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/log")) return new Response("2026-10-27T07:00:01.000Z WARN  Login required, SPC_EC=secretvalue99 rejected", { status: 200 });
      if (String(url).includes("/datasets/")) return new Response("[]", { status: 200 });
      return new Response(JSON.stringify({ data: { status: "SUCCEEDED", defaultDatasetId: "ds1" } }), { status: 200 });
    }));
    const { GET } = await import("./route");
    await GET();
    const err = String(snaps.find((s) => s.link_id === "L1")!.error);
    expect(err).toMatch(/Apify returned 0 results/);
    expect(err).toMatch(/Login required/);
    expect(err).toMatch(/no login token/);
    expect(err).not.toMatch(/secretvalue99/);
    vi.unstubAllGlobals();
  });

  it("a run that is still running is left alone", async () => {
    vi.stubGlobal("fetch", apify("RUNNING"));
    const { GET } = await import("./route");
    await GET();
    expect(snaps).toHaveLength(0);
    expect(updates).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("a failed Apify run gives every link a failed snapshot", async () => {
    vi.stubGlobal("fetch", apify("FAILED"));
    const { GET } = await import("./route");
    await GET();
    expect(snaps).toHaveLength(2);
    expect(snaps.every((s) => s.ok === false && /failed: boom/.test(String(s.error)))).toBe(true);
    expect(updates[0]).toMatchObject({ patch: { status: "failed" } });
    vi.unstubAllGlobals();
  });

  it("a run older than 15 minutes is stopped", async () => {
    runs = [run({ started_at: new Date(Date.now() - 20 * 60_000).toISOString() })];
    const f = apify("RUNNING"); vi.stubGlobal("fetch", f);
    const { GET } = await import("./route");
    await GET();
    expect(f.mock.calls.some((c) => String(c[0]).includes("/abort"))).toBe(true);
    expect(updates[0]).toMatchObject({ patch: { status: "failed", error: expect.stringMatching(/15 minutes/) } });
    vi.unstubAllGlobals();
  });
});
