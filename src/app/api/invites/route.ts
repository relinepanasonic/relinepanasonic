import { NextRequest, NextResponse } from "next/server";
import { WORKSPACES, isWorkspaceId, type WorkspaceId } from "@/lib/workspace";
import { createClient } from "@supabase/supabase-js";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

async function verifyAdmin(req: NextRequest) {
  const db = admin();
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return null;
  const { data: p } = await db.from("profiles").select("role,client_id,workspaces").eq("id", user.id).single();
  if (!p || !["superadmin", "client_admin"].includes(p.role)) return null;
  return { user, role: p.role as string, client_id: p.client_id as string | null, workspaces: (p.workspaces as string[] | null) ?? ["gobel"] };
}

// the workspace the caller is working in (cookie "ws"), default Reline Project 1.0
const wsOf = (req: NextRequest): WorkspaceId => (isWorkspaceId(req.cookies.get("ws")?.value) ? (req.cookies.get("ws")!.value as WorkspaceId) : "gobel");

// GET — list invites. Superadmin sees everything; client_admin only sees
// their own client's Dealer Owner (branch_manager) invites -- matching
// what they're actually allowed to create/revoke.
export async function GET(req: NextRequest) {
  const caller = await verifyAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const db = admin();
  let q = db
    .from("invites")
    .select("id,token,owner_name,store_name,role,created_at,expires_at,used_at,workspaces")
    .order("created_at", { ascending: false });
  if (caller.role === "client_admin") {
    q = q.eq("role", "branch_manager").eq("client_id", caller.client_id);
  }
  const { data } = await q;

  // the Users page of a workspace lists only the invites that give access to THAT workspace
  const ws = wsOf(req);
  const invites = ((data as { workspaces?: string[] | null }[] | null) ?? []).filter((i) => (i.workspaces?.length ? i.workspaces : ["gobel"]).includes(ws));
  return NextResponse.json({ invites });
}

// POST — create invite. client_admin (e.g. "Vani") may only invite Dealer
// Owner (branch_manager) accounts, scoped to their own client -- the role
// and client_id from the request body are ignored for them, not just
// validated, so there's no way to slip a different role/client through.
export async function POST(req: NextRequest) {
  const caller = await verifyAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json() as { owner_name: string; store_name?: string; role: string; username?: string | null; client_id?: string | null; scope_stores?: string[]; workspaces?: string[] };
  if (!body.owner_name?.trim()) return NextResponse.json({ error: "Owner name is required" }, { status: 400 });

  const isClientAdmin = caller.role === "client_admin";
  const role = isClientAdmin ? "branch_manager" : (body.role || "branch_manager");
  const clientId = isClientAdmin ? caller.client_id : (body.client_id || caller.client_id);

  // Workspace access of the new person. Only a Super Admin can give more than the workspace they are in (and a Super Admin invite always gets all of
  // them); an Admin invites into the workspace they are working in, and only if they may use it themselves.
  const cookieWs = wsOf(req);
  let workspaces: string[] = [cookieWs];
  if (role === "superadmin") workspaces = WORKSPACES.map((w) => w.id);
  else if (caller.role === "superadmin" && Array.isArray(body.workspaces)) {
    const picked = [...new Set(body.workspaces.filter((x): x is string => typeof x === "string" && isWorkspaceId(x)))];
    if (picked.length) workspaces = picked;
  } else if (caller.role === "client_admin" && !caller.workspaces.includes(cookieWs)) {
    return NextResponse.json({ error: "You do not have access to this workspace" }, { status: 403 });
  }

  const db = admin();
  const { data: inv, error } = await db
    .from("invites")
    .insert({
      owner_name:   body.owner_name.trim(),
      store_name:   body.store_name?.trim() || null,
      role,
      username:     body.username?.trim() || null,
      client_id:    clientId,
      created_by:   caller.user.id,
      scope_stores: role === "sales" ? (body.scope_stores?.length ? body.scope_stores : null) : null,
      // join copies this to the new profile (profiles.workspaces)
      workspaces,
    })
    .select("token")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token: inv.token });
}

// DELETE — revoke invite. client_admin may only revoke their own client's
// Dealer Owner invites.
export async function DELETE(req: NextRequest) {
  const caller = await verifyAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await req.json() as { id: string };
  const db = admin();
  if (caller.role === "client_admin") {
    const { data: target } = await db.from("invites").select("role,client_id").eq("id", id).single();
    if (!target || target.role !== "branch_manager" || target.client_id !== caller.client_id) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
  }
  await db.from("invites").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
