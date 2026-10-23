import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";
import { exceptionKindOf, parseExceptionMatrix, type ExceptionKind } from "@/lib/parseExceptions";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Manual { year?: number; bulan?: string; city?: string; pic_client?: string; store_name?: string }

const KIND_FILE: Record<ExceptionKind, string> = { cancel: "Order.cancelled", failed: "Order.failed_delivery", return: "Order.return_refund" };

// Upload one of the three "not a completed order" Shopee exports (?kind=cancel|failed|return) -> order_exception_rows of the
// ACTIVE workspace: the data behind Demographic > Retur. Re-uploading replaces rows by key (a return's status changes over time).
// Super Admin and Admin only.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("client_id, role").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  if (!["superadmin", "client_admin"].includes(profile.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const kind = req.nextUrl.searchParams.get("kind") as ExceptionKind | null;
  if (!kind || !(kind in KIND_FILE)) return NextResponse.json({ error: "Unknown file type." }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const manual: Manual = JSON.parse(String(form.get("manual") || "{}"));
  const clientId = String(form.get("client_id") || "");
  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });
  if (!manual.store_name) return NextResponse.json({ error: "Pick a Dealer first." }, { status: 400 });

  const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "orders") || wb.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: false });
  const found = matrix.length ? exceptionKindOf(matrix) : null;
  if (found !== kind) {
    return NextResponse.json({ error: found
      ? `This is an ${KIND_FILE[found]} file — upload it in its own slot.`
      : `This is not a Shopee ${KIND_FILE[kind]} export (header row not found).` }, { status: 400 });
  }

  const parsed = parseExceptionMatrix(matrix, kind);
  if (!parsed.length) return NextResponse.json({ ok: true, rows: 0, empty: true });

  const admin = createAdminClient(await currentSchema());
  const { data: upload, error: upErr } = await admin.from("uploads")
    .insert({ client_id: clientId, source: "retur", filename: file.name, uploaded_by: user.id, meta: { ...manual, kind } })
    .select("id").single();
  if (upErr || !upload) return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });

  const records = parsed.map((r) => ({
    client_id: clientId, upload_id: upload.id, kind: r.kind, row_key: r.row_key,
    year: r.year, month: r.month, week: r.week,
    dealer_city: manual.city ?? null, store_name: manual.store_name ?? null, pic_client: manual.pic_client ?? null,
    ref_no: r.ref_no, order_no: r.order_no, event_at: r.event_at, order_created_at: r.order_created_at,
    status: r.status, reason: r.reason, product_name: r.product_name, variant_name: r.variant_name,
    qty: r.qty, amount: r.amount, total_payment: r.total_payment, payment_method: r.payment_method,
    shipping_option: r.shipping_option, tracking_no: r.tracking_no, buyer_username: r.buyer_username,
    city: r.city, province: r.province, extra: r.extra,
  }));

  const CHUNK = 500;
  let saved = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const { error } = await admin.from("order_exception_rows").upsert(slice, { onConflict: "client_id,kind,row_key" });
    if (error) {
      await admin.from("uploads").delete().eq("id", upload.id);   // every row saved so far (new or replaced) belongs to this upload and goes with it: upload the file again
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    saved += slice.length;
  }
  await admin.from("uploads").update({ row_count: saved }).eq("id", upload.id);

  const orders = new Set(parsed.map((r) => r.order_no)).size;
  return NextResponse.json({ ok: true, upload_id: upload.id, rows: saved, orders });
}
