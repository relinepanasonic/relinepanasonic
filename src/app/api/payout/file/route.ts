import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "payout-files";

async function guard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 }) } as const;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin"].includes(profile.role)) {
    return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  }
  return { supabase } as const;
}

// POST /api/payout/file
//   { action: "sign",   batch, kind: "proof"|"receipt", filename }  -> { path, token }  (the browser then uploads the file
//                                                                      straight to storage: no 4.5 MB request limit)
//   { action: "commit", batch, kind, path, name }                    -> records the file, moves the payout status on
//   { action: "remove", batch, kind }                                -> forgets the file again
// GET /api/payout/file?batch=...&kind=proof|receipt                  -> redirect to a short-lived signed link
// Super Admin and Admin only. The proof / receipt live in the private storage bucket "payout-files".
export async function POST(req: NextRequest) {
  const g = await guard(); if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as { action?: string; batch?: string; kind?: string; filename?: string; path?: string; name?: string } | null;
  if (!body?.batch || (body.kind !== "proof" && body.kind !== "receipt")) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  const schema = await currentSchema();
  const admin = createAdminClient(schema);

  if (body.action === "sign") {
    const safe = (body.filename || "file").replace(/[^\w.-]+/g, "_").slice(-80);
    const path = `${schema}/${body.batch}/${body.kind}-${Date.now()}-${safe}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: error?.message || "Could not prepare the upload (is the storage bucket payout-files created? run migration 67)" }, { status: 500 });
    return NextResponse.json({ path, token: data.token });
  }
  if (body.action === "commit") {
    if (!body.path || !body.path.startsWith(`${schema}/${body.batch}/`)) return NextResponse.json({ error: "BAD_PATH" }, { status: 400 });
    const { data, error } = await g.supabase.rpc("payout_set_file", { p_batch_id: body.batch, p_kind: body.kind, p_path: body.path, p_name: body.name || "file" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, ...(data as object) });
  }
  if (body.action === "remove") {
    const { data, error } = await g.supabase.rpc("payout_set_file", { p_batch_id: body.batch, p_kind: body.kind, p_path: null, p_name: null });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, ...(data as object) });
  }
  return NextResponse.json({ error: "BAD_ACTION" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const g = await guard(); if ("error" in g) return g.error;
  const batch = req.nextUrl.searchParams.get("batch") || "";
  const kind = req.nextUrl.searchParams.get("kind");
  if (!batch || (kind !== "proof" && kind !== "receipt")) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  // the path is read with the caller's own session (RLS), never taken from the request
  const col = kind === "proof" ? "proof_path" : "receipt_path";
  const { data: row } = await g.supabase.from("payout_batches").select(`${col}`).eq("id", batch).single();
  const path = (row as Record<string, string | null> | null)?.[col];
  if (!path) return NextResponse.json({ error: "NO_FILE" }, { status: 404 });
  const admin = createAdminClient(await currentSchema());
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 120);
  if (error || !data) return NextResponse.json({ error: error?.message || "NO_FILE" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
