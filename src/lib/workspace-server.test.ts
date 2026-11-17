import { describe, it, expect, vi, beforeEach } from "vitest";

let cookieValue: string | undefined;
let user: { id: string } | null = { id: "u1" };
let profile: { role?: string; workspaces?: string[] | null } | null = null;
let lookupError = false;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "ws" && cookieValue ? { value: cookieValue } : undefined) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (lookupError ? { data: null, error: { message: "x" } } : { data: profile, error: null }) }) }) }) }),
}));

describe("the workspace of a request", () => {
  beforeEach(() => { cookieValue = undefined; user = { id: "u1" }; profile = null; lookupError = false; });

  it("a person with ONE workspace can never get another one, whatever the cookie says", async () => {
    const { currentWorkspaceId, currentSchema } = await import("./workspace-server");
    profile = { role: "branch_manager", workspaces: ["gobel"] };
    cookieValue = "alpha";
    expect(await currentWorkspaceId()).toBe("gobel");
    expect(await currentSchema()).toBe("public");
    cookieValue = "light"; expect(await currentWorkspaceId()).toBe("gobel");
    cookieValue = "gobel"; expect(await currentWorkspaceId()).toBe("gobel");
  });

  it("a person with several workspaces keeps the cookie when it is one of theirs, else gets their first", async () => {
    const { currentWorkspaceId } = await import("./workspace-server");
    profile = { role: "client_admin", workspaces: ["gobel", "alpha"] };
    cookieValue = "alpha"; expect(await currentWorkspaceId()).toBe("alpha");
    cookieValue = "light"; expect(await currentWorkspaceId()).toBe("gobel");
    profile = { role: "client_admin", workspaces: ["alpha"] };
    cookieValue = "gobel"; expect(await currentWorkspaceId()).toBe("alpha");
  });

  it("a Super Admin may use every workspace; nobody listed means Reline Project 1.0", async () => {
    const { currentWorkspaceId } = await import("./workspace-server");
    profile = { role: "superadmin", workspaces: ["gobel"] };
    cookieValue = "light"; expect(await currentWorkspaceId()).toBe("light");
    profile = { role: "sales", workspaces: null };
    cookieValue = "alpha"; expect(await currentWorkspaceId()).toBe("gobel");
    profile = null;
    cookieValue = "alpha"; expect(await currentWorkspaceId()).toBe("gobel");
  });

  it("no cookie = Reline Project 1.0 (when allowed); not logged in keeps the cookie; a failed lookup throws", async () => {
    const { currentWorkspaceId } = await import("./workspace-server");
    profile = { role: "sales", workspaces: ["gobel"] };
    expect(await currentWorkspaceId()).toBe("gobel");
    user = null; cookieValue = "alpha";
    expect(await currentWorkspaceId()).toBe("alpha");
    user = { id: "u1" }; lookupError = true;
    await expect(currentWorkspaceId()).rejects.toThrow();
  });

  it("allowedWorkspaceIds follows the order of the workspaces", async () => {
    const { allowedWorkspaceIds } = await import("./workspace-server");
    expect(allowedWorkspaceIds({ role: "x", workspaces: ["alpha", "gobel"] })).toEqual(["gobel", "alpha"]);
    expect(allowedWorkspaceIds({ role: "superadmin" })).toEqual(["gobel", "light", "alpha"]);
    expect(allowedWorkspaceIds({ role: "x", workspaces: ["nonsense"] })).toEqual(["gobel"]);
  });
});
