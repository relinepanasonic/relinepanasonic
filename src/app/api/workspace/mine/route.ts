import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowedWorkspaceIds } from "@/lib/workspace-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/workspace/mine -> { workspaces: ["gobel", "alpha", ...] }: the workspaces the logged-in person may enter (a Super Admin: all).
// The Welcome page asks this instead of reading the profile table itself: the database refuses requests for a workspace the person has no access
// to (Supabase Migration/107), and before a workspace is chosen the browser would be asking for Reline Project 1.0.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { data: p, error } = await createAdminClient().from("profiles").select("role, workspaces").eq("id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "lookup_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ workspaces: allowedWorkspaceIds(p as { role?: string; workspaces?: string[] | null } | null) }, { headers: { "Cache-Control": "no-store" } });
}
