import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";
import { isOrdersHeader, parseOrdersMatrix } from "@/lib/parseOrders";
import { weekOfMonth } from "@/lib/parseFinance";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ShipManual {
  year?: number; bulan?: string; city?: string;
  pic_client?: string; store_name?: string;
}

// Upload a Shopee "Order.shipping" export (orders handed to the logistics partner) ->
// order_ship_rows of the ACTIVE workspace: the data behind the Demographic page's
// "Order Shipped" table. Same columns as Order.completed plus "Waktu Pengiriman Diatur".
// Super Admin and Admin only.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("client_id, role").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  if (!["superadmin", "client_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const manual: ShipManual = JSON.parse(String(form.get("manual") || "{}"));
  const clientId = String(form.get("client_id") || "");

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });
  if (!manual.store_name) return NextResponse.json({ error: "Pick a Dealer first." }, { status: 400 });
  if (!manual.year || !manual.bulan) return NextResponse.json({ error: "Pick Year and Month first." }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "orders") || wb.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: false });
  if (!matrix.length || !isOrdersHeader(matrix)) {
    return NextResponse.json({ error: "This is not a Shopee Order.shipping export (header row not found)." }, { status: 400 });
  }
  if (!matrix[0].some((h) => String(h ?? "").trim() === "Waktu Pengiriman Diatur")) {
    return NextResponse.json({ error: "This looks like an Order.completed file — upload it in the Order Completed card." }, { status: 400 });
  }

  const parsed = parseOrdersMatrix(matrix);
  if (!parsed.length) {
    return NextResponse.json({ ok: true, rows: 0, skipped_orders: 0, empty: true });
  }

  const admin = createAdminClient(await currentSchema());

  // Orders already stored for this dealer are skipped (an overlapping export must not double the
  // daily counts); everything else in the file is still saved.
  const orderNos = Array.from(new Set(parsed.map((r) => r.order_no).filter(Boolean) as string[]));
  const already = new Set<string>();
  for (let i = 0; i < orderNos.length; i += 300) {
    const { data } = await admin.from("order_ship_rows").select("order_no")
      .eq("client_id", clientId).eq("store_name", manual.store_name).in("order_no", orderNos.slice(i, i + 300));
    (data || []).forEach((x: { order_no: string }) => already.add(x.order_no));
  }
  const fresh = parsed.filter((r) => r.order_no && !already.has(r.order_no));
  if (!fresh.length) {
    return NextResponse.json({ ok: true, rows: 0, skipped_orders: already.size, empty: false });
  }

  const { data: upload, error: upErr } = await admin
    .from("uploads")
    .insert({ client_id: clientId, source: "orders_ship", filename: file.name, uploaded_by: user.id, meta: { ...manual } })
    .select("id")
    .single();
  if (upErr || !upload) {
    return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });
  }

  // Week comes from the ship date, anchored to the chosen month's 5-week grid (same as Earning).
  const records = fresh.map((r) => ({
    client_id: clientId,
    upload_id: upload.id,
    year: manual.year ?? null,
    month: manual.bulan ?? null,
    week: r.shipped_at ? weekOfMonth(r.shipped_at.slice(0, 10), manual.year!, manual.bulan!) : null,
    dealer_city: manual.city ?? null,
    store_name: manual.store_name ?? null,
    pic_client: manual.pic_client ?? null,
    order_no: r.order_no,
    order_type: r.order_type,
    order_status: r.order_status,
    cancel_return_status: r.cancel_return_status,
    tracking_no: r.tracking_no,
    shipping_option: r.shipping_option,
    ship_deadline: r.ship_deadline,
    shipped_at: r.shipped_at,
    order_created_at: r.order_created_at,
    paid_at: r.paid_at,
    payment_method: r.payment_method,
    product_name: r.product_name,
    variant_name: r.variant_name,
    qty: r.qty,
    returned_qty: r.returned_qty,
    total_payment: r.total_payment,
    buyer_username: r.buyer_username,
    city: r.city,
    province: r.province,
    subtotal_pesanan: r.subtotal_pesanan,
    est_shipping_fee: r.est_shipping_fee,
    return_shipping_fee: r.return_shipping_fee,
    buyer_shipping_fee: r.buyer_shipping_fee,
    est_shipping_cost: r.est_shipping_cost,
  }));

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const { error } = await admin.from("order_ship_rows").insert(slice);
    if (error) {
      await admin.from("uploads").delete().eq("id", upload.id); // cascades the rows already inserted
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    inserted += slice.length;
  }

  await admin.from("uploads").update({ row_count: inserted }).eq("id", upload.id);
  return NextResponse.json({ ok: true, upload_id: upload.id, rows: inserted, skipped_orders: already.size });
}
