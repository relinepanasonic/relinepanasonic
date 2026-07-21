import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAdGroupMatrix, inferGroupLevel } from "@/lib/parseAdGroup";
import { normalizeMonth, type ManualFields } from "@/lib/parse";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/ads-group/upload — the "Data Grup Iklan / Shop GMV Max" matrix
// export. Writes to ad_groups (Supabase Migration/30), separate from the flat
// Ads Performa export handled by /api/upload. No rollup refresh (Reline reads
// ad_groups directly via ads_dashboard_summary()).
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("client_id, role").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  if (!["superadmin", "client_admin", "advertiser"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const manual: ManualFields = JSON.parse(String(form.get("manual") || "{}"));
  const clientId = String(form.get("client_id") || "");
  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });

  // Parse the matrix export.
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
  if (!matrix.length) return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });

  const parsed = parseAdGroupMatrix(matrix);
  if (!parsed.rows.length) {
    return NextResponse.json({ error: "No ad-group rows found — is this the 'Data Grup Iklan / Shop GMV Max' export?" }, { status: 400 });
  }

  const grupIklan = (manual.grup_iklan?.trim() || parsed.grupIklan) ?? null;
  const adsLevel = manual.ads_level || inferGroupLevel(grupIklan);
  // This is the Panasonic ads dashboard — ad-group rows default to Panasonic
  // (the ads_dashboard_summary RPC filters brand='panasonic'); an explicit
  // manual.brand override wins if ever supplied.
  const brand = manual.brand?.trim() || "Panasonic";
  const admin = createAdminClient();

  // Audit row first (uploads.source is the spos|ads|perf enum — use 'ads';
  // the group/level/period detail lives in meta).
  const { data: upload, error: upErr } = await admin
    .from("uploads")
    .insert({
      client_id: clientId,
      source: "ads",
      filename: file.name,
      uploaded_by: user.id,
      meta: { ...manual, kind: "ads_group", grup_iklan: grupIklan, ads_level: adsLevel,
              periode_start: parsed.periodeStart, periode_end: parsed.periodeEnd },
    })
    .select("id").single();
  if (upErr || !upload) return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });

  const rows = parsed.rows.map((r) => ({
    client_id: clientId,
    upload_id: upload.id,
    year: manual.year ?? null,
    month: normalizeMonth(manual.bulan) ?? null,
    week: manual.week ?? null,
    city: manual.city ?? null,
    store_name: manual.store_name ?? parsed.storeName ?? null,
    pic_client: manual.pic_client ?? null,
    brand,
    grup_iklan: grupIklan,
    ads_level: adsLevel,
    level: r.level,
    item_name: r.item_name,
    kode_produk: r.kode_produk,
    dilihat: r.dilihat,
    klik: r.klik,
    konversi: r.konversi,
    konversi_langsung: r.konversi_langsung,
    produk_terjual: r.produk_terjual,
    terjual_langsung: r.terjual_langsung,
    add_to_cart: r.add_to_cart,
    omzet: r.omzet,
    penjualan_langsung: r.penjualan_langsung,
    biaya: r.biaya,
    roas: r.roas,
    roas_langsung: r.roas_langsung,
    periode_start: parsed.periodeStart,
    periode_end: parsed.periodeEnd,
  }));

  // Smaller files than SPOS — single insert, no chunking.
  const { error } = await admin.from("ad_groups").insert(rows);
  if (error) {
    await admin.from("uploads").delete().eq("id", upload.id); // rollback
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await admin.from("uploads").update({ row_count: rows.length }).eq("id", upload.id);

  return NextResponse.json({ ok: true, upload_id: upload.id, rows: rows.length, grup_iklan: grupIklan, ads_level: adsLevel });
}
