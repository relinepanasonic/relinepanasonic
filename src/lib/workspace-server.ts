import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_WORKSPACE, WORKSPACE_COOKIE, WORKSPACES, isWorkspaceId, schemaFor, type WorkspaceId } from "./workspace";

// Server only (route handlers / server components): the active workspace of THIS request.
//
// It is the workspace cookie, but only when the logged-in person may enter that workspace (profiles.workspaces; a Super Admin may enter all).
// The cookie can be changed by hand, and many API routes use the service-role client with this schema, so a request for a workspace the
// person has no access to is moved to one of their own workspaces here: it can never read or write another workspace's data.
// Not logged in: the cookie is kept (public endpoints such as /api/join). A failed access lookup throws (a wrong workspace would be worse).
export async function currentWorkspaceId(): Promise<WorkspaceId> {
  const v = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const wanted: WorkspaceId = isWorkspaceId(v) ? v : DEFAULT_WORKSPACE;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return wanted;

  const { data: p, error } = await createAdminClient().from("profiles").select("role, workspaces").eq("id", user.id).maybeSingle();
  if (error) throw new Error("Could not check the workspace access");
  const allowed = allowedWorkspaceIds(p as { role?: string; workspaces?: string[] | null } | null);
  return allowed.includes(wanted) ? wanted : allowed[0];
}

// The workspaces a profile may enter, in the order of WORKSPACES. A Super Admin: all. Nobody listed: Reline Project 1.0.
export function allowedWorkspaceIds(p: { role?: string; workspaces?: string[] | null } | null): WorkspaceId[] {
  if (p?.role === "superadmin") return WORKSPACES.map((w) => w.id);
  const mine = p?.workspaces?.length ? p.workspaces : [DEFAULT_WORKSPACE];
  const ids = WORKSPACES.filter((w) => mine.includes(w.id)).map((w) => w.id);
  return ids.length ? ids : [DEFAULT_WORKSPACE];
}

export async function currentSchema(): Promise<string> {
  return schemaFor(await currentWorkspaceId());
}
