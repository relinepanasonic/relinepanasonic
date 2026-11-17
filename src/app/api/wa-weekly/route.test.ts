import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let user: { id: string } | null = { id: "u1" };
let profile: { role: string; display_name: string | null; email: string | null } | null = { role: "client_admin", display_name: "Vani", email: "vani@x.id" };
let dealerExists = true;
let workspace = "alpha";
const dealerQueries: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => table === "profiles"
      ? { select: () => ({ eq: () => ({ single: async () => ({ data: profile }) }) }) }
      : { select: () => ({ eq: (_c: string, v: string) => ({ limit: async () => { dealerQueries.push(v); return { data: dealerExists ? [{ id: 1 }] : [], error: null }; } }) }) },
  }),
}));
vi.mock("@/lib/workspace-server", () => ({ currentWorkspaceId: async () => workspace }));
const order: string[] = [];
let warmFails = false;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (schema = "public") => ({
    rpc: async (fn: string) => { order.push(`${fn}@${schema}`); return warmFails ? { data: null, error: { message: "boom" } } : { data: false, error: null }; },
  }),
}));

const KEY = "test-only-erp-key-do-not-use";
const fetchMock = vi.fn();
const erp = (status: number, body: unknown) => fetchMock.mockImplementationOnce(async () => { order.push("erp"); return new Response(body === null ? "" : JSON.stringify(body), { status }); });
const post = (body: unknown) => new NextRequest(new URL("/api/wa-weekly", "http://localhost"), { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const OK = { store: "Sumber Multi - Cinere", week: "2026-11-02", action: "preview" };

describe("POST /api/wa-weekly", () => {
  beforeEach(() => {
    process.env.ERP_API_KEY = KEY;
    user = { id: "u1" }; profile = { role: "client_admin", display_name: "Vani", email: "vani@x.id" }; dealerExists = true; workspace = "alpha"; dealerQueries.length = 0; order.length = 0; warmFails = false;
    fetchMock.mockReset(); fetchMock.mockImplementation(async () => { order.push("erp"); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }); vi.stubGlobal("fetch", fetchMock);
  });

  it("needs a logged-in Super Admin or Admin; nothing is sent to the ERP otherwise", async () => {
    const { POST } = await import("./route");
    user = null; expect((await POST(post(OK))).status).toBe(401);
    user = { id: "u1" }; profile = { role: "branch_manager", display_name: "X", email: null }; expect((await POST(post(OK))).status).toBe(403);
    profile = null; expect((await POST(post(OK))).status).toBe(403);
    profile = { role: "superadmin", display_name: "Nico", email: null }; erp(200, { ok: true }); expect((await POST(post(OK))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates the body and the dealer before calling the ERP", async () => {
    const { POST } = await import("./route");
    for (const b of [{}, { store: "", action: "preview" }, { store: "X" }, { store: "X", action: "delete" }, { store: "X", action: "send", week: "11/02/2026" }, { store: "x".repeat(201), action: "send" }]) {
      const r = await POST(post(b)); expect(r.status).toBe(400); expect((await r.json()).error).toBe("bad_request");
    }
    dealerExists = false;
    const r = await POST(post(OK)); expect(r.status).toBe(400); expect((await r.json()).message).toContain("Sumber Multi - Cinere");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the ERP once with the bearer key, source reline, the workspace name, the dealer, the week, the action and sentBy from the session", async () => {
    erp(200, { ok: true, store: "S", label: "L", client: "C", week: { from: "2026-11-02", to: "2026-11-08" }, group: "G", status: "preview", caption: "cap", imageUrl: "https://img/x.png", secret: "no" });
    const { POST } = await import("./route");
    const r = await POST(post({ ...OK, sentBy: "Hacker", source: "dashboard", workspace: "Other" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const j = await r.json();
    expect(j.imageUrl).toBe("https://img/x.png"); expect(j.group).toBe("G"); expect(j.week).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(j.secret).toBeUndefined();                                   // only the known fields are passed on
    expect(JSON.stringify(j)).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://erp.profesoronline.id/api/v1/erp/wa/client-weekly");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body)).toEqual({ source: "reline", store: "Sumber Multi - Cinere", workspace: "Alpha Project", week: "2026-11-02", action: "preview", resend: false, sentBy: "Vani" });
    expect(dealerQueries).toEqual(["Sumber Multi - Cinere"]);
  });

  it("a send forwards resend: true only when asked; the week is optional", async () => {
    const { POST } = await import("./route");
    erp(200, { ok: true, sent: true, detail: "d" });
    await POST(post({ store: "S", action: "send", resend: true }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ source: "reline", store: "S", workspace: "Alpha Project", action: "send", resend: true, sentBy: "Vani" });
    erp(200, { ok: true, sent: true });
    await POST(post({ store: "S", action: "send", resend: "yes" }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).resend).toBe(false);
  });

  it("passes the ERP's answers on: 404 no_data, 409 no_group, 409 already_sent, 502 send_failed", async () => {
    const { POST } = await import("./route");
    erp(404, { error: "no_data", message: "No numbers yet" });
    let r = await POST(post(OK)); expect([r.status, (await r.json()).error]).toEqual([404, "no_data"]);
    erp(409, { error: "no_group" });
    r = await POST(post(OK)); expect([r.status, (await r.json()).error]).toEqual([409, "no_group"]);
    erp(409, { error: "already_sent", sentAt: "2026-11-09T03:00:00.000Z" });
    r = await POST(post({ ...OK, action: "send" })); const a = await r.json(); expect([r.status, a.error, a.sentAt]).toEqual([409, "already_sent", "2026-11-09T03:00:00.000Z"]);
    erp(502, { error: "send_failed", message: "WhatsApp refused" });
    r = await POST(post({ ...OK, action: "send" })); const f = await r.json(); expect([r.status, f.error, f.message]).toEqual([502, "send_failed", "WhatsApp refused"]);
  });

  it("an ERP 401 is a configuration problem, an unreadable answer or a network error is a 502; never an automatic retry", async () => {
    const { POST } = await import("./route");
    erp(401, null);
    let r = await POST(post({ ...OK, action: "send" })); let j = await r.json(); expect([r.status, j.error]).toEqual([502, "erp_auth"]);
    erp(500, null);
    r = await POST(post({ ...OK, action: "send" })); j = await r.json(); expect([r.status, j.error]).toEqual([502, "erp_error"]);
    fetchMock.mockRejectedValueOnce(new Error("down"));
    r = await POST(post({ ...OK, action: "send" })); j = await r.json(); expect([r.status, j.error]).toEqual([502, "erp_unreachable"]);
    const abort = new Error("timeout"); abort.name = "AbortError"; fetchMock.mockRejectedValueOnce(abort);
    r = await POST(post({ ...OK, action: "send" })); j = await r.json(); expect([r.status, j.error]).toEqual([502, "timeout"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);                         // one call per request, no retries
  });

  it("rebuilds the weekly numbers of the active workspace BEFORE asking the ERP, so the ERP does not hit a stale cache", async () => {
    const { POST } = await import("./route");
    erp(200, { ok: true });
    await POST(post(OK));
    expect(order).toEqual(["erp_perf_refresh_if_stale@ws_alpha", "erp"]);
    workspace = "gobel"; order.length = 0; erp(200, { ok: true });
    await POST(post({ ...OK, action: "send" }));
    expect(order).toEqual(["erp_perf_refresh_if_stale@public", "erp"]);
  });

  it("a failed warm-up does not stop the call to the ERP", async () => {
    const { POST } = await import("./route");
    warmFails = true; erp(200, { ok: true, group: "G" });
    const r = await POST(post(OK));
    expect(r.status).toBe(200); expect(order).toEqual(["erp_perf_refresh_if_stale@ws_alpha", "erp"]);
  });

  it("action warm only rebuilds the numbers (Upload page, right after an upload): admin only, nothing goes to the ERP", async () => {
    const { POST } = await import("./route");
    const r = await POST(post({ action: "warm" }));
    expect(r.status).toBe(200); expect((await r.json()).ok).toBe(true);
    expect(order).toEqual(["erp_perf_refresh_if_stale@ws_alpha"]); expect(fetchMock).not.toHaveBeenCalled();
    profile = { role: "sales", display_name: "S", email: null }; order.length = 0;
    expect((await POST(post({ action: "warm" }))).status).toBe(403); expect(order).toEqual([]);
  });

  it("no key on the server is a 500 and nothing is sent", async () => {
    const { POST } = await import("./route");
    delete process.env.ERP_API_KEY;
    const r = await POST(post(OK));
    expect(r.status).toBe(500); expect((await r.json()).error).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
