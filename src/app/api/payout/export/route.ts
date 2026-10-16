import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { buildPayoutXlsx, exportFileName, type PayoutBatch, type PayoutLine } from "@/lib/payoutExport";
import { PayoutDocument } from "@/lib/payoutPdf";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/payout/export?batch=<payout id>&format=xlsx|pdf
// The payout as a file with two tabs / pages: Summary (per product) and Detail (per order line).
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
  const format = req.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  if (!batchId) return NextResponse.json({ error: "NO_BATCH" }, { status: 400 });

  const { data, error } = await supabase.rpc("payout_lines_of", { p_batch_id: batchId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const res = data as { batch: PayoutBatch | null; lines: PayoutLine[] };
  if (!res?.batch) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const name = exportFileName(res.batch, format);
  const body = format === "pdf"
    ? await renderToBuffer(PayoutDocument({ batch: res.batch, lines: res.lines }))
    : buildPayoutXlsx(res.batch, res.lines);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
