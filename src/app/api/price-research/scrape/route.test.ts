import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let role: string | null = "superadmin";
let links: { id: string; client_id: string; platform: string; product_url: string }[] = [];
let runningRuns: { link_ids: string[] }[] = [];
let runsInserted: Record<string, unknown>[] = [];
let snapsInserted: Record<string, unknown>[] = [];

// a thenable query-builder: every chain method returns itself, awaiting resolves to what the table says
function chain(result: () => unknown, onInsert?: (rows: Record<string, unknown> | Record<string, unknown>[]) => void) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, or: () => b, order: () => b, limit: () => b,
    insert: async (rows: Record<string, unknown> | Record<string, unknown>[]) => { onInsert?.(rows); return { error: null }; },
    then: (resolve: (v: unknown) => void) => resolve(result()),
  };
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: role ? { id: "u1" } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: role ? { role } : null }) }) }) }),
  }),
}));
vi.mock("@/lib/workspace-server", () => ({ currentSchema: async () => "public" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) =>
      t === "price_research_links" ? chain(() => ({ data: links, error: null }))
      : t === "price_research_runs" ? chain(() => ({ data: runningRuns, error: null }), (r) => runsInserted.push(r as Record<string, unknown>))
      : chain(() => ({ error: null }), (r) => snapsInserted.push(...(Array.isArray(r) ? r : [r]))),
  }),
}));

const post = (body: unknown) => new NextRequest("http://localhost/api/price-research/scrape", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const started = (id = "run1") => vi.fn(async () => new Response(JSON.stringify({ data: { id, defaultDatasetId: "ds1" } }), { status: 201 }));

describe("POST /api/price-research/scrape (starts the Apify runs and returns at once)", () => {
  beforeEach(() => {
    role = "superadmin"; runningRuns = []; runsInserted = []; snapsInserted = [];
    process.env.APIFY_TOKEN = "t";
    links = [
      { id: "L1", client_id: "C", platform: "tokopedia", product_url: "https://www.tokopedia.com/rival/ac-1pk?src=x" },
      { id: "L3", client_id: "C", platform: "tiktok", product_url: "https://shop-id.tokopedia.com/pdp/x/1729653353364556550" },
    ];
  });

  it("is for Super Admin / Admin only and needs the token", async () => {
    const { POST } = await import("./route");
    role = null; expect((await POST(post({ link_ids: ["L1"] }))).status).toBe(401);
    role = "sales"; expect((await POST(post({ link_ids: ["L1"] }))).status).toBe(403);
    role = "superadmin"; delete process.env.APIFY_TOKEN;
    const r = await POST(post({ link_ids: ["L1"] })); expect(r.status).toBe(400); expect((await r.json()).error).toMatch(/APIFY_TOKEN/);
    process.env.APIFY_TOKEN = "t"; expect((await POST(post({ link_ids: [] }))).status).toBe(400);
  });

  it("starts one Apify run per marketplace, with clean URLs, and records it", async () => {
    const f = started(); vi.stubGlobal("fetch", f);
    const { POST } = await import("./route");
    const res = await POST(post({ link_ids: ["L1", "L3"] }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.started).toEqual([{ platform: "tokopedia", links: 1 }, { platform: "tiktok", links: 1 }]);
    expect(f).toHaveBeenCalledTimes(2);
    const input = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(input.startUrls).toEqual(["https://www.tokopedia.com/rival/ac-1pk"]);            // ?src=x is dropped
    expect(runsInserted).toHaveLength(2);
    expect(runsInserted[0]).toMatchObject({ platform: "tokopedia", apify_run_id: "run1", dataset_id: "ds1", link_ids: ["L1"], client_id: "C" });
    vi.unstubAllGlobals();
  });

  it("does not start a link that is already being scraped; an Apify error becomes a failed snapshot", async () => {
    runningRuns = [{ link_ids: ["L1"] }];
    links.push({ id: "S1", client_id: "C", platform: "shopee", product_url: "https://shopee.co.id/x-i.1.2" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 402 })));
    const { POST } = await import("./route");
    const j = await (await POST(post({ link_ids: ["L1", "L3", "S1"] }))).json();
    expect(runsInserted).toHaveLength(0);                                                  // L1 busy, L3 and S1 refused by Apify
    expect(j.failed).toBe(2);
    expect(String(snapsInserted.find((r) => r.link_id === "S1")!.error)).toMatch(/Apify 402/);
    expect(String(snapsInserted.find((r) => r.link_id === "L3")!.error)).toMatch(/Apify 402/);
    expect(snapsInserted.every((r) => r.ok === false)).toBe(true);
    vi.unstubAllGlobals();
  });
});
