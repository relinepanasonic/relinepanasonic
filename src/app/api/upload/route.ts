import { NextRequest, NextResponse, after } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapRow, bqCol, type DataSource, type ManualFields } from "@/lib/parse";

export const runtime = "nodejs";
export const maxDuration = 60;

const SOURCES: DataSource[] = ["spos", "ads", "perf"];

// Find the header row index for a sheet by looking for a known column.
// Shopee CSV/xlsx exports often have a metadata preamble before the header.
// Returns -1 when no known header is present — the caller MUST reject the
// file rather than guessing. Falling back to row 0 (as this used to) makes
// the metadata preamble the header, so every "data" row maps to nulls and
// the upload silently lands as junk; worse, a file that does have campaigns
// gets every column mis-mapped and lands as silently wrong numbers.
function findHeaderRow(rows: unknown[][], mustInclude: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").toLowerCase());
    if (mustInclude.some((m) => cells.some((c) => c.includes(m.toLowerCase())))) {
      return i;
    }
  }
  return -1;
}

const HEADER_HINTS: Record<DataSource, string[]> = {
  spos: ["Produk", "Kode Produk"],
  ads: ["Nama Iklan"],
  perf: ["Total Pengunjung", "Kunjungan"],
};

// mapRow() in lib/parse.ts reads every metric by its Indonesian column name,
// so an English-language Shopee export cannot be parsed even if we located
// its header. Detect it to give an actionable message instead of a generic
// "header not found".
// Taken from real English exports. Each token is absent from the Indonesian
// header for the same source, so these cannot false-positive:
//   spos  ID "Kode Produk / SKU Induk"      EN "Item ID / Parent SKU"
//   perf  ID "Total Pengunjung (Kunjungan)" EN "Visitors (Visit)"
//   ads   ID "Nama Iklan / Mode Bidding"    EN "Ad Name / Bidding Method"
const ENGLISH_HINTS: Record<DataSource, string[]> = {
  spos: ["item id", "current item status", "parent sku"],
  ads: ["ad name", "impression", "bidding method"],
  perf: ["visitors (visit)", "conversion rate"],
};
function looksEnglish(rows: unknown[][], source: DataSource): boolean {
  const hints = ENGLISH_HINTS[source];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").toLowerCase());
    if (hints.some((h) => cells.some((c) => c.includes(h)))) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  // 1. Verify the caller and resolve their profile (client + role).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("client_id, role")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  if (!["superadmin", "client_admin", "advertiser"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // 2. Read the multipart form: a file, its source, target client, manual fields.
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const source = String(form.get("source") || "") as DataSource;
  const manual: ManualFields = JSON.parse(String(form.get("manual") || "{}"));

  // superadmin & client_admin are both global → the target client comes from
  // the form (a dropdown sourced from Core List, never free-typed).
  const clientId = String(form.get("client_id") || "");

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!SOURCES.includes(source))
    return NextResponse.json({ error: "BAD_SOURCE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });
  // Advertisers may only upload Ads exports.
  if (profile.role === "advertiser" && source !== "ads")
    return NextResponse.json({ error: "ADVERTISER_ADS_ONLY" }, { status: 403 });

  // 3. Parse the file (xlsx or csv) with SheetJS.
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });

  if (!matrix.length)
    return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });

  const headerIdx = findHeaderRow(matrix, HEADER_HINTS[source]);
  if (headerIdx === -1) {
    // Reject rather than guess — see findHeaderRow().
    return NextResponse.json({
      error: looksEnglish(matrix, source)
        ? `File ini adalah export Shopee berbahasa Inggris. Ubah bahasa Shopee ke Indonesia lalu export ulang — kolomnya dibaca memakai nama kolom Indonesia (mis. "${HEADER_HINTS[source][0]}").`
        : `Header tidak ditemukan — file ini sepertinya bukan export ${source.toUpperCase()}. Kolom wajib: "${HEADER_HINTS[source].join('" / "')}".`,
    }, { status: 400 });
  }
  const headers = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
  const dataRows = matrix.slice(headerIdx + 1);

  // 4. Build raw row objects keyed by both original header and bqCol form,
  //    then map to typed sales_rows fields.
  const admin = createAdminClient();

  // Source brand/category detection from this workspace's live Core List
  // (master_data) so admin-added brands are picked up without a code deploy.
  // Falls back to the hardcoded lists in parse.ts if the Core List is empty.
  const { data: dictRows } = await admin
    .from("master_data")
    .select("kind,value")
    .eq("client_id", clientId)
    .in("kind", ["brand", "platform"]);
  const brands = (dictRows || []).filter((r) => r.kind === "brand").map((r) => r.value);
  const categories = (dictRows || []).filter((r) => r.kind === "platform").map((r) => r.value);

  // Create the upload record first so rows can FK to it.
  const { data: upload, error: upErr } = await admin
    .from("uploads")
    .insert({
      client_id: clientId,
      source,
      filename: file.name,
      uploaded_by: user.id,
      meta: manual,
    })
    .select("id")
    .single();
  if (upErr || !upload)
    return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });

  const mapped = dataRows
    .filter((r) => Array.isArray(r) && r.some((c) => c !== "" && c != null))
    .map((r) => {
      const raw: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        const val = (r as unknown[])[i] ?? null;
        raw[h] = val;
        raw[bqCol(h)] = val; // also store sanitized key so mapRow's get() hits
      });
      const row = mapRow(source, raw, manual, { brands, categories });
      return { ...row, client_id: clientId, upload_id: upload.id };
    });

  // 5. Bulk insert in chunks (Postgres handles large inserts; chunk to stay light).
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const slice = mapped.slice(i, i + CHUNK);
    const { error } = await admin.from("sales_rows").insert(slice);
    if (error) {
      // roll back this upload's rows so we don't leave a partial load
      await admin.from("uploads").delete().eq("id", upload.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    inserted += slice.length;
  }

  await admin
    .from("uploads")
    .update({ row_count: inserted })
    .eq("id", upload.id);

  // Refresh the dashboard's cached "All Time" snapshot after the response
  // is sent — recomputing it live on every page load doesn't scale as
  // sales_rows keeps growing every quarter (see migration 19).
  after(async () => {
    await admin.rpc("refresh_dashboard_snapshot", { p_client_id: clientId });
  });

  return NextResponse.json({ ok: true, upload_id: upload.id, rows: inserted });
}
