import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WORKSPACE_COOKIE, isWorkspaceId } from "@/lib/workspace";

// GET /api/workspace?ws=gobel|light — remember the chosen workspace, then go
// to the app. The caller must be logged in AND allowed into that workspace
// (superadmin: all; others: profiles.workspaces). Session cookie (no max-age),
// readable by JS on purpose — the browser Supabase client needs it to pick
// the right schema.
export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get("ws");
  if (!isWorkspaceId(ws)) return NextResponse.redirect(new URL("/welcome", req.url));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  // Shared table (public schema) read with the service role: no RLS surprises.
  const { data: p } = await createAdminClient().from("profiles").select("role, workspaces").eq("id", user.id).single();
  const allowed: string[] = (p?.workspaces as string[] | null) ?? ["gobel"];
  if (p?.role !== "superadmin" && !allowed.includes(ws)) {
    return NextResponse.redirect(new URL("/welcome?denied=" + ws, req.url));
  }

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(WORKSPACE_COOKIE, ws, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
