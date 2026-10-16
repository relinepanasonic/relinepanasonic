import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Item { kode_produk: string; nama_produk: string; kode_variasi: string; nama_variasi: string }

// POST /api/harga-beli/products  { client_id, rows: [{kode_produk, nama_produk, kode_variasi, nama_variasi}] }
// Adds the products / variants of the SPOS file (parsed in the browser) to the product list of the ACTIVE workspace.
// Existing entries get their names refreshed; nothing is ever removed. Super Admin and Admin only.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { client_id?: string; rows?: Item[] } | null;
  const clientId = String(body?.client_id || "");
  const rows = Array.isArray(body?.rows) ? body!.rows! : [];
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });
  if (!rows.length) return NextResponse.json({ error: "No products found - is this the SPOS file (Kode Produk / Produk columns)?" }, { status: 400 });
  if (rows.length > 60000) return NextResponse.json({ error: "Too many rows" }, { status: 400 });

  const admin = createAdminClient(await currentSchema());
  const before = await admin.from("product_variants").select("*", { count: "exact", head: true }).eq("client_id", clientId);

  const CHUNK = 1000;
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((r) => ({
      client_id: clientId,
      kode_produk: String(r.kode_produk),
      nama_produk: r.nama_produk || null,
      kode_variasi: String(r.kode_variasi || "-"),
      nama_variasi: r.nama_variasi || "-",
      updated_at: now,
    }));
    const { error } = await admin.from("product_variants").upsert(slice, { onConflict: "client_id,kode_produk,kode_variasi" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const after = await admin.from("product_variants").select("*", { count: "exact", head: true }).eq("client_id", clientId);
  return NextResponse.json({
    ok: true, received: rows.length, total: after.count ?? null,
    added: (after.count ?? 0) - (before.count ?? 0),
  });
}
