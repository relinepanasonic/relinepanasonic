import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST -> rebuilds the Price Research product list of the active workspace (our Panasonic SKUs and their average selling price).
// It scans the sales rows (20 s on the full Reline data), too long for the browser's database role, so it runs here with the service role.
// Super Admin and Admin only.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin"].includes(profile.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { client_id } = (await req.json().catch(() => ({}))) as { client_id?: string };
  if (!client_id) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });
  const admin = createAdminClient(await currentSchema());
  const { data, error } = await admin.rpc("price_research_refresh", { p_client_id: client_id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...(data as object) });
}
