import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Thenable query-builder mock: chain methods return itself, awaiting resolves to the table's fixed result.
function builder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {
    select: () => b, gte: () => b, lt: () => b, order: () => b, range: () => b,
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return b;
}
const U = (id: string, source: string, by: string | null, at: string, meta: Record<string, unknown>, filename = "f.csv") =>
  ({ id, source, filename, created_at: at, uploaded_by: by, meta });

let uploadsBySchema: Record<string, unknown[]> = {};
let profiles: unknown[] = [];
let users: unknown[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (schema = "public") => ({
    from: (t: string) => builder(t === "profiles" ? { data: profiles, error: null } : { data: uploadsBySchema[schema] ?? [], error: null }),
    auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } },
  }),
}));

const KEY = "test-only-key-do-not-use-in-prod";
const req = (url: string, key?: string) =>
  new NextRequest(new URL(url, "http://localhost"), { headers: key ? { authorization: `Bearer ${key}` } : {} });
const URL_OK = "/api/erp/upload-log?from=2026-10-01&to=2026-10-31";

describe("GET /api/erp/upload-log", () => {
  beforeEach(() => {
    process.env.ERP_API_KEY = KEY;
    uploadsBySchema = {};
    profiles = [
      { id: "u1", role: "client_admin", display_name: "Vani", workspaces: ["gobel", "alpha"] },
      { id: "u2", role: "client_admin", display_name: "Rina", workspaces: ["light"] },
      { id: "u3", role: "client_admin", display_name: "Gone", workspaces: ["gobel"] },
      { id: "u4", role: "superadmin", display_name: "Boss", workspaces: ["gobel", "light", "alpha"] },
    ];
    users = [{ id: "u3", banned_until: "2999-01-01T00:00:00Z" }];
  });

  it("401s with no key, a wrong key, or an unset env var, with an empty body", async () => {
    const { GET } = await import("./route");
    for (const r of [await GET(req(URL_OK)), await GET(req(URL_OK, "wrong"))]) { expect(r.status).toBe(401); expect(await r.text()).toBe(""); }
    delete process.env.ERP_API_KEY;
    expect((await GET(req(URL_OK, KEY))).status).toBe(401);
  });

  it("400s for a missing/invalid date or a range over 60 days", async () => {
    const { GET } = await import("./route");
    expect((await GET(req("/api/erp/upload-log?from=2026-10-01", KEY))).status).toBe(400);
    expect((await GET(req("/api/erp/upload-log?from=2026-10-31&to=2026-10-01", KEY))).status).toBe(400);
    expect((await GET(req("/api/erp/upload-log?from=2026-01-01&to=2026-03-15", KEY))).status).toBe(400);
    expect((await GET(req("/api/erp/upload-log?from=2026-08-01&to=2026-09-29", KEY))).status).toBe(200); // exactly 60 days
  });

  it("returns the shape: active admins (one per person) and grouped uploads from every workspace", async () => {
    uploadsBySchema = {
      public: [
        U("a1", "perf", "u1", "2026-10-20T08:07:00Z", { store_name: "Store A", bulan: "October" }, "performance oct.csv"),
        U("a2", "perf", "u1", "2026-10-20T08:09:00Z", { store_name: "Store A", bulan: "October" }, "performance oct 2.csv"),
        U("a3", "ads", null, "2026-10-19T01:00:00Z", { store_name: "Store B", bulan: "October", admin: "Someone" }, "ads.csv"),
      ],
      ws_alpha: [U("b1", "finance", "u1", "2026-10-21T01:00:00Z", { store_name: "Alpha Shop", bulan: "October" }, "income.xlsx")],
      ws_light: [U("c1", "ads", "u2", "2026-10-18T03:00:00Z", { kind: "ads_group", ads_level: "incubation", store_name: "L1", bulan: "October" })],
    };
    const { GET } = await import("./route");
    const res = await GET(req(URL_OK, KEY));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const j = await res.json();
    expect(j.timezone).toBe("Asia/Jakarta");
    expect(typeof j.generatedAt).toBe("string");
    expect(j.admins.map((a: { name: string }) => a.name)).toEqual(["Rina", "Vani"]); // banned "Gone" and the superadmin are left out
    const vani = j.admins.find((a: { name: string }) => a.name === "Vani");
    expect(vani.workspaces).toEqual(["Reline Project 1.0", "Alpha Project"]);
    expect(vani.stores).toEqual(["Alpha Shop", "Store A"]);
    expect(j.uploads).toHaveLength(4);
    expect(j.uploads[0]).toMatchObject({ type: "Earning", admin: "Vani", workspace: "Alpha Project", store: "Alpha Shop", month: "October", files: ["income.xlsx"], tags: ["Earning"] });
    const times = j.uploads.map((u: { uploadedAt: string }) => u.uploadedAt);
    expect(times).toEqual([...times].sort().reverse());
    const perf = j.uploads.find((u: { type: string }) => u.type === "Performa");
    expect(perf.files).toHaveLength(2); // two files of one upload -> one entry
    expect(perf.uploadedAt).toBe("2026-10-20T08:09:00.000Z");
    expect(j.uploads.find((u: { store: string }) => u.store === "Store B").admin).toBe("Someone"); // falls back to meta.admin
    expect(j.uploads.find((u: { workspace: string }) => u.workspace === "Panasonic Light Solution").type).toBe("GMV Auto");
    expect(new Set(j.uploads.map((u: { id: string }) => u.id)).size).toBe(4);
    expect(JSON.stringify(j)).not.toMatch(/@|storage|email/i);
  });
});
