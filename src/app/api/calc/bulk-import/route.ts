import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Bulk-fill for the Massive Calculator (/calc). Source layout: the user's
// "Massive Calculator" sheet -- a 3-row merged header (group label / sub
// label / unit), data starting on row 5. "Category" appears TWICE (the
// product-line free-text column right after Item Product, and the real
// fee-lookup Category further right after Platform/Jenis Toko) so columns
// are matched by header text + position, not by name alone.
//
// Only the raw inputs are imported (Item Product, product line, Modal
// Produk, Harga Jual, the 5 fee-lookup fields, target ROAS, Gratis Ongkir/
// Promo Xtra/Paylater toggles, Berat/Ukuran) -- Total Biaya/Profit/etc are
// always computed client-side from these + the linked market_fees row
// (page.tsx's computeCalc()), never stored, so nothing here needs to
// duplicate that math.

function parseRp(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/rp/i, "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}
function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim().replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function parseYesNo(v: unknown): boolean {
  return String(v ?? "").trim().toLowerCase() === "yes";
}

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim());
    if (cells.includes("Item Product") && cells.includes("Platform")) return i;
  }
  return -1;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("display_name, email, client_id").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });

  const admin = createAdminClient();
  const { data: cs } = await admin.from("clients").select("id").order("created_at").limit(1);
  const clientId = profile.client_id || cs?.[0]?.id;
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const headerIdx = findHeaderRow(matrix);
  if (headerIdx === -1) return NextResponse.json({ error: "Couldn't find a header row with Item Product/Platform columns" }, { status: 400 });
  const header = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
  const subHeader = (matrix[headerIdx + 2] || []).map((h) => String(h ?? "").trim()); // the "RP/%/ROAS/Yes-No/..." unit row

  const firstIdx = (name: string) => header.findIndex((h) => h === name);
  const lastIdx = (name: string) => { for (let i = header.length - 1; i >= 0; i--) if (header[i] === name) return i; return -1; };
  const idxAfter = (name: string, after: number) => header.findIndex((h, i) => h === name && i > after);
  const subIdx = (name: string) => subHeader.findIndex((h) => h === name);

  const itemIdx = firstIdx("Item Product");
  const platformIdx = firstIdx("Platform");
  const tokoIdx = firstIdx("Jenis Toko");
  const productLineIdx = idxAfter("Category", itemIdx); // first "Category" after Item Product = product line
  const modalIdx = firstIdx("Modal Produk");
  const hargaIdx = firstIdx("Harga Jual");
  const feeCatIdx = idxAfter("Category", tokoIdx); // second "Category" after Jenis Toko = fee-lookup category
  const subCatIdx = firstIdx("Sub Category");
  const jenisProductIdx = firstIdx("Jenis Product");
  const roasIdx = subIdx("ROAS");
  const beratIdx = subIdx("Berat (kg)");
  const ukuranIdx = subIdx("Uk (PxLXT) cm3");
  const ongkirIdx = header.findIndex((h) => h.startsWith("Gratis Ongkir")); // group header col = the Yes/No toggle
  const promoIdx = header.findIndex((h) => h.startsWith("Promo Xtra"));
  const paylater3Idx = header.findIndex((h) => h.startsWith("Shopee Paylater Xtra"));
  const paylater6Idx = matrix[headerIdx + 1]?.findIndex((h) => String(h ?? "").trim() === "6 Bulan") ?? -1;
  const biayaLainIdx = lastIdx("ID Biaya Lain");

  if (itemIdx === -1 || modalIdx === -1 || hargaIdx === -1) {
    return NextResponse.json({ error: "Missing Item Product / Modal Produk / Harga Jual columns" }, { status: 400 });
  }

  // Resolve each row's fee link against the client's own Market Place Fee
  // table (exact match on all 5 fields, same rule the Massive Calculator UI
  // uses to auto-fill Platform Fee/Ongkir/Promo/Paylater numbers).
  const { data: fees } = await admin.from("market_fees")
    .select("id, category, sub_category, jenis_product, platform, jenis_toko")
    .eq("client_id", clientId);
  const feeMap = new Map<string, string>();
  for (const f of fees || []) {
    feeMap.set([f.category, f.sub_category ?? "", f.jenis_product ?? "", f.platform, f.jenis_toko ?? ""].join(""), f.id);
  }

  const createdBy = profile.display_name || profile.email?.split("@")[0] || "Admin";
  let matched = 0, unmatched = 0;

  const rows = matrix.slice(headerIdx + 3)
    .filter((r) => String(r[itemIdx] ?? "").trim())
    .map((r) => {
      const feeKey = [
        String(r[feeCatIdx] ?? "").trim(),
        String(r[subCatIdx] ?? "").trim(),
        String(r[jenisProductIdx] ?? "").trim(),
        String(r[platformIdx] ?? "").trim(),
        String(r[tokoIdx] ?? "").trim(),
      ].join("");
      const feeId = feeMap.get(feeKey) ?? null;
      if (feeId) matched++; else unmatched++;

      return {
        client_id: clientId,
        item_product: String(r[itemIdx] ?? "").trim() || null,
        product_line: productLineIdx === -1 ? null : (String(r[productLineIdx] ?? "").trim() || null),
        modal_produk_rp: parseRp(r[modalIdx]),
        harga_jual_rp: parseRp(r[hargaIdx]),
        fee_id: feeId,
        target_roas: roasIdx === -1 ? 0 : parseNum(r[roasIdx]),
        berat_kg: beratIdx === -1 ? 0 : parseNum(r[beratIdx]),
        ukuran_cm3: ukuranIdx === -1 ? 0 : parseNum(r[ukuranIdx]),
        gratis_ongkir_on: ongkirIdx === -1 ? true : parseYesNo(r[ongkirIdx]),
        promo_xtra_on: promoIdx === -1 ? true : parseYesNo(r[promoIdx]),
        paylater_3mo_on: paylater3Idx === -1 ? false : parseYesNo(r[paylater3Idx]),
        paylater_6mo_on: paylater6Idx === -1 ? false : parseYesNo(r[paylater6Idx]),
        biaya_lain_rp: biayaLainIdx === -1 ? 0 : parseRp(r[biayaLainIdx]),
        created_by: createdBy,
      };
    });

  if (!rows.length) return NextResponse.json({ error: "No data rows found under the header" }, { status: 400 });

  const CHUNK = 500;
  let imported = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await admin.from("massive_calc_rows").insert(slice);
    if (error) return NextResponse.json({ error: error.message, imported }, { status: 500 });
    imported += slice.length;
  }

  return NextResponse.json({ ok: true, imported, matched, unmatched });
}
