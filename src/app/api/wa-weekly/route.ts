import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId } from "@/lib/workspace-server";
import { workspaceById } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/wa-weekly  { store, week?, action: "preview" | "send", resend? }
//
// The "Send weekly report to client group (Oli)" button. The accounting ERP makes the one-page report image and sends it to the client's WhatsApp
// group; this route only asks it to, ON THE SERVER, so ERP_API_KEY never reaches the browser.
//   - Only a logged-in Super Admin or Admin (the people who upload the weekly numbers). The store must be a dealer of the active workspace.
//   - source = "reline", workspace = the active workspace name, store = the dealer name exactly as in the performance data (sales_rows.store_name).
//   - sentBy = the logged-in person's name (taken from the session, never from the request).
//   - NO automatic retry: one request here is one call to the ERP. "Send again" is a deliberate second click that comes in with resend: true.
// The ERP's answers are passed on (same status, known fields only); a 401 from the ERP is shown as a configuration problem, never as the ERP's own text.

const ERP_URL = process.env.ERP_WA_CLIENT_WEEKLY_URL || "https://erp.profesoronline.id/api/v1/erp/wa/client-weekly";
const TIMEOUT_MS = 55_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_STORE = { "Cache-Control": "no-store" };
const KNOWN = ["ok", "store", "label", "client", "week", "group", "status", "caption", "imageUrl", "sent", "detail", "error", "message", "sentAt"] as const;

const out = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return out({ error: "AUTH_REQUIRED" }, 401);
  const { data: profile } = await supabase.from("profiles").select("role, display_name, email").eq("id", user.id).single();
  const p = profile as { role?: string; display_name?: string | null; email?: string | null } | null;
  if (!p || (p.role !== "superadmin" && p.role !== "client_admin")) return out({ error: "FORBIDDEN" }, 403);

  const key = process.env.ERP_API_KEY;
  if (!key) return out({ error: "not_configured", message: "ERP_API_KEY is not set on the server." }, 500);

  const b = (await req.json().catch(() => ({}))) as { store?: unknown; week?: unknown; action?: unknown; resend?: unknown };
  const store = typeof b.store === "string" ? b.store.trim() : "";
  if (!store || store.length > 200) return out({ error: "bad_request", message: "Pick a dealer first." }, 400);
  const action = b.action === "send" ? "send" : b.action === "preview" ? "preview" : null;
  if (!action) return out({ error: "bad_request", message: "action must be preview or send." }, 400);
  const week = b.week == null || b.week === "" ? undefined : b.week;
  if (week !== undefined && (typeof week !== "string" || !DATE_RE.test(week))) return out({ error: "bad_request", message: "week must be a date, YYYY-MM-DD." }, 400);

  // only a dealer that exists in this workspace may be sent to a client group
  const { data: hit, error: herr } = await supabase.from("sales_rows").select("id").eq("store_name", store).limit(1);
  if (herr) return out({ error: "bad_request", message: "Could not check the dealer." }, 500);
  if (!hit || hit.length === 0) return out({ error: "bad_request", message: `No data for dealer "${store}" in this workspace.` }, 400);

  const ws = workspaceById(await currentWorkspaceId());
  const sentBy = (p.display_name || p.email?.split("@")[0] || "").trim() || undefined;
  const payload = { source: "reline", store, workspace: ws.name, ...(week ? { week } : {}), action, resend: b.resend === true, ...(sentBy ? { sentBy } : {}) };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ERP_URL, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: ctl.signal, cache: "no-store",
    });
    if (res.status === 401) return out({ error: "erp_auth", message: "The ERP did not accept the key (401). Ask the administrator to check ERP_API_KEY." }, 502);
    const text = await res.text();
    let j: Record<string, unknown> | null = null;
    try { j = text ? (JSON.parse(text) as Record<string, unknown>) : null; } catch { j = null; }
    if (!j || typeof j !== "object") return out({ error: "erp_error", message: `The ERP answered ${res.status} without a readable body.` }, 502);
    const body: Record<string, unknown> = {};
    for (const k of KNOWN) if (k in j) body[k] = j[k];
    const status = [200, 400, 404, 409, 502].includes(res.status) ? res.status : 502;
    if (status === 502 && !body.error) body.error = "erp_error";
    if (status === 502 && !body.message) body.message = `The ERP answered ${res.status}.`;
    return out(body, status);
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return out({ error: aborted ? "timeout" : "erp_unreachable", message: aborted ? "The ERP did not answer in time. Check WhatsApp before sending again: the report may have gone out." : "The ERP could not be reached." }, 502);
  } finally {
    clearTimeout(timer);
  }
}
