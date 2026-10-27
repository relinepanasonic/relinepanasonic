import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let role: string | null = "superadmin";
let links: { id: string; client_id: string; platform: string; product_url: string }[] = [];
let inserted: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: role ? { id: "u1" } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: role ? { role } : null }) }) }) }),
  }),
}));
vi.mock("@/lib/workspace-server", () => ({ currentSchema: async () => "public" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => t === "price_research_links"
      ? { select: () => ({ in: async () => ({ data: links, error: null }) }) }
      : { insert: async (rows: Record<string, unknown>[]) => { inserted = rows; return { error: null }; } },
  }),
}));

const post = (body: unknown) => new NextRequest("http://localhost/api/price-research/scrape", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const apify = (items: unknown[], status = 200) => vi.fn(async () => new Response(JSON.stringify(items), { status, headers: { "x-apify-run-id": "run1" } }));

describe("POST /api/price-research/scrape", () => {
  beforeEach(() => {
    role = "superadmin"; inserted = [];
    process.env.APIFY_TOKEN = "t"; process.env.APIFY_SHOPEE_COOKIE = "cookie";
    links = [
      { id: "L1", client_id: "C", platform: "tokopedia", product_url: "https://www.tokopedia.com/rival/ac-1pk" },
      { id: "L2", client_id: "C", platform: "tokopedia", product_url: "https://www.tokopedia.com/rival/gone" },
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

  it("saves a price per matched link and a failed snapshot for the link with no result", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("tokopedia~tokopedia") || String(url).includes("khadinakbar")) {
        return new Response(JSON.stringify([{ url: "https://www.tokopedia.com/rival/ac-1pk", priceInt: 3500000, name: "AC 1 PK", shopName: "Rival", rating: 4.9 }]), { status: 200, headers: { "x-apify-run-id": "run1" } });
      }
      return new Response(JSON.stringify([{ product_id: "1729653353364556550", sale_price_value: 99000, origin_price: 120000, sold_count: 12, title: "T", shop_name: "S" }]), { status: 200 });
    }));
    const { POST } = await import("./route");
    const res = await POST(post({ link_ids: ["L1", "L2", "L3"] }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j).toMatchObject({ ok: true, scraped: 2, failed: 1 });
    const by = (id: string) => inserted.find((r) => r.link_id === id)!;
    expect(by("L1")).toMatchObject({ ok: true, price: 3500000, title: "AC 1 PK", shop_name: "Rival", client_id: "C" });
    expect(by("L2")).toMatchObject({ ok: false, price: null });
    expect(String(by("L2").error)).toMatch(/No result/);
    expect(by("L3")).toMatchObject({ ok: true, price: 99000, original_price: 120000, sold: 12 });
    vi.unstubAllGlobals();
  });

  it("an Apify error becomes failed snapshots (the last good price is never replaced) and the Shopee cookie is required", async () => {
    links = [{ id: "S1", client_id: "C", platform: "shopee", product_url: "https://shopee.co.id/x-i.1.2" }, { id: "T1", client_id: "C", platform: "tokopedia", product_url: "https://www.tokopedia.com/a/b" }];
    delete process.env.APIFY_SHOPEE_COOKIE;
    vi.stubGlobal("fetch", apify([], 402));
    const { POST } = await import("./route");
    const j = await (await POST(post({ link_ids: ["S1", "T1"] }))).json();
    expect(j.failed).toBe(2);
    expect(inserted.every((r) => r.ok === false)).toBe(true);
    expect(String(inserted.find((r) => r.link_id === "S1")!.error)).toMatch(/APIFY_SHOPEE_COOKIE/);
    expect(String(inserted.find((r) => r.link_id === "T1")!.error)).toMatch(/Apify 402/);
    vi.unstubAllGlobals();
  });
});
