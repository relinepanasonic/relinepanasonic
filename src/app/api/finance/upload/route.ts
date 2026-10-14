import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";
import { parseFinanceMatrix, weekOfMonth } from "@/lib/parseFinance";
import { isNewFinanceLayout, parseFinanceNewWorkbook } from "@/lib/parseFinanceNew";

export const runtime = "nodejs";
export const maxDuration = 60;

// Same manual fields the Upload page already sends to /api/upload.
interface FinanceManual {
  year?: number; bulan?: string; city?: string;
  pic_client?: string; store_name?: string;
}

const CHUNK = 500;

// Upload a Shopee "Laporan Penghasilan" (Income) export of the ACTIVE
// workspace. Super Admin and Admin only (same as the other uploads).
//   * OLD layout (sheet "Income")  -> finance_rows, one row per order.
//   * NEW layout (sheet "Penghasilan") -> finance_rows (Order rows, incl. Pajak)
//     AND finance_items (one row per product per order = REAL per-product costs).
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
  const manual: FinanceManual = JSON.parse(String(form.get("manual") || "{}"));
  const clientId = String(form.get("client_id") || "");

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });
  if (!manual.store_name) return NextResponse.json({ error: "Pick a Dealer first." }, { status: 400 });
  if (!manual.year || !manual.bulan) return NextResponse.json({ error: "Pick Year and Month first." }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetOf = (n: string) => wb.SheetNames.find((x) => x.toLowerCase() === n);
  const matrixOf = (name: string | undefined) =>
    name ? XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false }) : [];

  const isNew = isNewFinanceLayout(wb.SheetNames);

  // Parse first, so a bad file never creates an upload record.
  let orderRecords: Record<string, unknown>[] = [];
  let itemRecords: Record<string, unknown>[] = [];
  let meta: Record<string, unknown> = {};
  const week = (iso: string | null) => (manual.year && manual.bulan ? weekOfMonth(iso, manual.year, manual.bulan) : null);
  const dims = {
    year: manual.year ?? null,
    month: manual.bulan ?? null,
    dealer_city: manual.city ?? null,
    store_name: manual.store_name ?? null,
    pic_client: manual.pic_client ?? null,
  };

  if (isNew) {
    const parsed = parseFinanceNewWorkbook(matrixOf(sheetOf("penghasilan")), matrixOf(sheetOf("summary")));
    if (!parsed.orders.length) {
      return NextResponse.json({ error: "No order rows found in the Penghasilan sheet — is this a Shopee Laporan Penghasilan export?" }, { status: 400 });
    }
    meta = { ...manual, layout: "penghasilan", username: parsed.username, periode_start: parsed.periodeStart, periode_end: parsed.periodeEnd, items: parsed.items.length };
    orderRecords = parsed.orders.map((r) => ({
      ...dims,
      week: week(r.release_date),
      order_no: r.order_no,
      buyer_username: r.buyer_username,
      payment_method: r.payment_method,
      order_date: r.order_date,
      release_date: r.release_date,
      sales: r.sales,
      promotion_cost: r.promotion_cost,
      refund: r.refund,
      delivery_cost: r.delivery_cost,
      affiliate_cost: r.affiliate_cost,
      marketplace_fee: r.marketplace_fee,
      misc: r.misc,
      net_income: r.net_income,
      jasa_kirim: r.jasa_kirim,
      nama_kurir: r.nama_kurir,
      tax: r.tax,
      tax_base: r.tax_base,
      tax_base_exvat: r.tax_base_exvat,
    }));
    itemRecords = parsed.items.map((r) => ({
      ...dims,
      week: week(r.release_date),
      order_no: r.order_no,
      kode_produk: r.kode_produk,
      nama_produk: r.nama_produk,
      order_date: r.order_date,
      release_date: r.release_date,
      sales: r.sales,
      refund: r.refund,
      promotion_cost: r.promotion_cost,
      delivery_cost: r.delivery_cost,
      platform_fee: r.platform_fee,
      xtra_fee: r.xtra_fee,
      service_fee: r.service_fee,
      campaign_fee: r.campaign_fee,
      affiliate_cost: r.affiliate_cost,
      misc: r.misc,
      other_fee: r.other_fee,
      tax: r.tax,
      tax_base: r.tax_base,
      tax_base_exvat: r.tax_base_exvat,
      net_income: r.net_income,
    }));
  } else {
    const matrix = matrixOf(sheetOf("income") || wb.SheetNames[0]);
    if (!matrix.length) return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });
    const parsed = parseFinanceMatrix(matrix);
    if (!parsed.rows.length) {
      return NextResponse.json({ error: "No order rows found in the Income sheet — is this a Shopee Laporan Penghasilan export?" }, { status: 400 });
    }
    meta = { ...manual, layout: "income", username: parsed.username, periode_start: parsed.periodeStart, periode_end: parsed.periodeEnd };
    orderRecords = parsed.rows.map((r) => ({
      ...dims,
      week: week(r.release_date),
      order_no: r.order_no,
      buyer_username: r.buyer_username,
      payment_method: r.payment_method,
      order_date: r.order_date,
      release_date: r.release_date,
      sales: r.sales,
      promotion_cost: r.promotion_cost,
      refund: r.refund,
      delivery_cost: r.delivery_cost,
      affiliate_cost: r.affiliate_cost,
      marketplace_fee: r.marketplace_fee,
      misc: r.misc,
      net_income: r.net_income,
      jasa_kirim: r.jasa_kirim,
      nama_kurir: r.nama_kurir,
    }));
  }

  const admin = createAdminClient(await currentSchema());

  const { data: upload, error: upErr } = await admin
    .from("uploads")
    .insert({ client_id: clientId, source: "finance", filename: file.name, uploaded_by: user.id, meta })
    .select("id")
    .single();
  if (upErr || !upload) {
    return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });
  }

  const insertAll = async (table: string, records: Record<string, unknown>[]) => {
    for (let i = 0; i < records.length; i += CHUNK) {
      const slice = records.slice(i, i + CHUNK).map((r) => ({ ...r, client_id: clientId, upload_id: upload.id }));
      const { error } = await admin.from(table).insert(slice);
      if (error) return error.message;
    }
    return null;
  };

  const e1 = await insertAll("finance_rows", orderRecords);
  const e2 = e1 ? null : await insertAll("finance_items", itemRecords);
  if (e1 || e2) {
    await admin.from("uploads").delete().eq("id", upload.id); // cascades both tables
    return NextResponse.json({ error: e1 || e2 }, { status: 500 });
  }

  await admin.from("uploads").update({ row_count: orderRecords.length }).eq("id", upload.id);
  return NextResponse.json({ ok: true, upload_id: upload.id, rows: orderRecords.length, products: itemRecords.length, layout: isNew ? "penghasilan" : "income" });
}
