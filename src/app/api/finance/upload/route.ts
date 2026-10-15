import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";
import { parseFinanceMatrix, weekOfMonth, type FinanceRow } from "@/lib/parseFinance";
import { isIncomeSkuMatrix, parseIncomeSkuMatrix, type SkuRow } from "@/lib/parseIncomeSku";

export const runtime = "nodejs";
export const maxDuration = 60;

// The Upload page sends City / Dealer / PIC / Year / Bulan (no Owner / Brand).
interface FinanceManual {
  year?: number; bulan?: string; city?: string;
  pic_client?: string; store_name?: string;
}

// Upload a Shopee "Laporan Penghasilan" (Earning) export -> finance_rows.
// Two layouts are accepted: the older one-row-per-order "Income" sheet, and the
// newer "Penghasilan" sheet whose per-product lines also go to finance_sku_rows
// (real per-product costs, see Supabase Migration/57 and lib/parseIncomeSku.ts).
// Super Admin and Admin only (same as the other uploads); writes into the
// ACTIVE workspace's schema.
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
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === "income") ||
    wb.SheetNames.find((n) => n.toLowerCase() === "penghasilan") ||
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // Newer layout? Detect on the untouched cell values (numbers stay numbers,
  // so a "-3,510" style number format can never be mis-read).
  const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  if (!rawMatrix.length) return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });

  let parsed: { username: string | null; periodeStart: string | null; periodeEnd: string | null; rows: FinanceRow[] };
  let skuRows: SkuRow[] = [];
  let unreconciled = 0;
  const newLayout = isIncomeSkuMatrix(rawMatrix);
  if (newLayout) {
    const summaryWs = wb.Sheets[wb.SheetNames.find((n) => n.toLowerCase() === "summary") || ""];
    const summary = summaryWs ? XLSX.utils.sheet_to_json<unknown[]>(summaryWs, { header: 1, defval: "" }) : undefined;
    const r = parseIncomeSkuMatrix(rawMatrix, summary);
    parsed = r; skuRows = r.skuRows; unreconciled = r.unreconciled;
  } else {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
    parsed = parseFinanceMatrix(matrix);
  }
  if (!parsed.rows.length) {
    return NextResponse.json({ error: "No order rows found in the Earning sheet — is this a Shopee Laporan Penghasilan export?" }, { status: 400 });
  }

  const admin = createAdminClient(await currentSchema());

  // Orders already in the system would be inserted a second time and double every cost
  // (the per-product lines are summed). Refuse and say how to replace them.
  {
    const orderNos = Array.from(new Set(parsed.rows.map((r) => r.order_no).filter(Boolean) as string[]));
    const already = new Set<string>();
    for (let i = 0; i < orderNos.length; i += 300) {
      const { data } = await admin.from("finance_rows").select("order_no")
        .eq("client_id", clientId).eq("store_name", manual.store_name).in("order_no", orderNos.slice(i, i + 300));
      (data || []).forEach((x: { order_no: string }) => already.add(x.order_no));
    }
    if (already.size > 0) {
      return NextResponse.json({
        error: `${already.size} of these ${orderNos.length} orders are already uploaded for this store. Delete the earlier upload first (Upload history), then upload this file again.`,
        code: "DUPLICATE_ORDERS", duplicate_orders: already.size,
      }, { status: 409 });
    }
  }

  const { data: upload, error: upErr } = await admin
    .from("uploads")
    .insert({
      client_id: clientId,
      source: "finance",
      filename: file.name,
      uploaded_by: user.id,
      meta: { ...manual, username: parsed.username, periode_start: parsed.periodeStart, periode_end: parsed.periodeEnd },
    })
    .select("id")
    .single();
  if (upErr || !upload) {
    return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });
  }

  // Week is derived per transaction from its own release_date, anchored to the
  // chosen month's 5-week grid (Week 5 naturally spills a few days into the next month).
  const dims = {
    client_id: clientId,
    upload_id: upload.id,
    year: manual.year ?? null,
    month: manual.bulan ?? null,
    dealer_city: manual.city ?? null,
    store_name: manual.store_name ?? null,
    pic_client: manual.pic_client ?? null,
  };
  const records = parsed.rows.map((r) => ({
    ...dims,
    week: weekOfMonth(r.release_date, manual.year!, manual.bulan!),
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
    // only the new layout carries Pajak; older uploads keep the column default (0)
    ...(r.pajak !== undefined ? { pajak: r.pajak } : {}),
  }));

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const { error } = await admin.from("finance_rows").insert(slice);
    if (error) {
      await admin.from("uploads").delete().eq("id", upload.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    inserted += slice.length;
  }

  // Per-product lines (new layout) -> finance_sku_rows, same dimensions as the orders.
  let skuInserted = 0;
  if (skuRows.length) {
    const skuRecords = skuRows.map((s) => ({ ...dims, week: weekOfMonth(s.release_date, manual.year!, manual.bulan!), ...s }));
    for (let i = 0; i < skuRecords.length; i += CHUNK) {
      const slice = skuRecords.slice(i, i + CHUNK);
      const { error } = await admin.from("finance_sku_rows").insert(slice);
      if (error) {
        await admin.from("uploads").delete().eq("id", upload.id); // cascades finance_rows + finance_sku_rows
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      skuInserted += slice.length;
    }
  }

  await admin.from("uploads").update({ row_count: inserted }).eq("id", upload.id);

  return NextResponse.json({
    ok: true, upload_id: upload.id, rows: inserted,
    ...(newLayout ? { layout: "penghasilan", product_lines: skuInserted, unreconciled_orders: unreconciled } : {}),
  });
}
