import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;
let profile: { role: string; client_id: string | null; workspaces: string[] | null } = { role: "superadmin", client_id: null, workspaces: ["gobel", "light", "alpha"] };
let inserted: Row | null = null;
let invitesRows: Row[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: (t: string) => t === "profiles"
      ? { select: () => ({ eq: () => ({ single: async () => ({ data: profile }) }) }) }
      : {
          insert: (row: Row) => { inserted = row; return { select: () => ({ single: async () => ({ data: { token: "TOKEN" }, error: null }) }) }; },
          select: () => { const q: Record<string, unknown> = {}; q.order = () => q; q.eq = () => q; q.then = (res: (v: unknown) => unknown) => res({ data: invitesRows }); return q; },
        },
  }),
}));

const req = (method: string, ws?: string, body?: unknown) => new NextRequest(new URL("/api/invites", "http://localhost"), {
  method, headers: { authorization: "Bearer t", ...(ws ? { cookie: `ws=${ws}` } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
});

describe("invites and workspace access", () => {
  beforeEach(() => { profile = { role: "superadmin", client_id: null, workspaces: ["gobel", "light", "alpha"] }; inserted = null; invitesRows = []; });

  it("an invite gets the workspace the inviter is in; a Super Admin can pick more", async () => {
    const { POST } = await import("./route");
    await POST(req("POST", "alpha", { owner_name: "Rina", role: "branch_manager" }));
    expect(inserted?.workspaces).toEqual(["alpha"]);
    await POST(req("POST", "alpha", { owner_name: "Rina", role: "branch_manager", workspaces: ["alpha", "gobel", "nonsense", "alpha"] }));
    expect(inserted?.workspaces).toEqual(["alpha", "gobel"]);
    await POST(req("POST", undefined, { owner_name: "Rina", role: "branch_manager" }));
    expect(inserted?.workspaces).toEqual(["gobel"]);
    await POST(req("POST", "gobel", { owner_name: "Rina", role: "branch_manager", workspaces: ["nonsense"] }));
    expect(inserted?.workspaces).toEqual(["gobel"]);
  });

  it("a Super Admin invite can enter every workspace", async () => {
    const { POST } = await import("./route");
    await POST(req("POST", "alpha", { owner_name: "Boss", role: "superadmin" }));
    expect(inserted?.workspaces).toEqual(["gobel", "light", "alpha"]);
  });

  it("an Admin cannot give more access than their workspace, and only into a workspace they may use", async () => {
    const { POST } = await import("./route");
    profile = { role: "client_admin", client_id: "c1", workspaces: ["gobel", "alpha"] };
    await POST(req("POST", "alpha", { owner_name: "Rina", role: "branch_manager", workspaces: ["gobel", "light", "alpha"] }));
    expect(inserted?.workspaces).toEqual(["alpha"]);
    inserted = null;
    profile = { role: "client_admin", client_id: "c1", workspaces: ["gobel"] };
    const r = await POST(req("POST", "alpha", { owner_name: "Rina", role: "branch_manager" }));
    expect(r.status).toBe(403);
    expect(inserted).toBeNull();
  });

  it("the invite list of a workspace shows only the invites that give access to it", async () => {
    const { GET } = await import("./route");
    invitesRows = [
      { id: "1", owner_name: "A", workspaces: ["gobel"] }, { id: "2", owner_name: "B", workspaces: ["alpha"] },
      { id: "3", owner_name: "C", workspaces: ["gobel", "alpha"] }, { id: "4", owner_name: "D", workspaces: null },
    ];
    const ids = async (ws?: string) => ((await (await GET(req("GET", ws))).json()).invites as { id: string }[]).map((i) => i.id);
    expect(await ids("alpha")).toEqual(["2", "3"]);
    expect(await ids("gobel")).toEqual(["1", "3", "4"]);
    expect(await ids("light")).toEqual([]);
  });
});
