import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildPayoutXlsx, exportFileName, type PayoutBatch, type PayoutLine } from "@/lib/payoutExport";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/payout/export?batch=<payout id>&format=xlsx
// The payout as an XLSX with two tabs: Summary (per product) and Detail (per order line).
// (The PDF is built in the browser, lib/payoutPdfClient.ts: a 1,500-line PDF is too slow for a serverless function.)
// Super Admin and Admin only; the data is read with the caller's own session (row-level security applies).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const batchId = req.nextUrl.searchParams.get("batch") || "";
  if (!batchId) return NextResponse.json({ error: "NO_BATCH" }, { status: 400 });

  const { data, error } = await supabase.rpc("payout_lines_of", { p_batch_id: batchId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const res = data as { batch: PayoutBatch | null; lines: PayoutLine[] };
  if (!res?.batch) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = buildPayoutXlsx(res.batch, res.lines);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${exportFileName(res.batch, "xlsx")}"`,
      "Cache-Control": "no-store",
    },
  });
}
