import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { MonthlyReportDocument, prevMonth, type ReportType, type Summary } from "@/lib/reportPdf";

export const runtime = "nodejs";

type Body = {
  reportType: ReportType;
  city?: string;
  store?: string;
  year: number;
  month: string;
};

export async function POST(req: NextRequest) {
  // Reports are an admin tool — only superadmin/client_admin may generate
  // one, for any city/store (not self-serve by the actual CEO/Brand
  // Manager/Dealer Owner logins).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const b = (await req.json()) as Body;
  const { reportType, city, store, year, month } = b;
  if (!reportType || !year || !month) {
    return NextResponse.json({ error: "reportType, year and month are required" }, { status: 400 });
  }
  if (reportType === "brand_manager" && !city) {
    return NextResponse.json({ error: "city is required for a Brand Manager report" }, { status: 400 });
  }
  if (reportType === "dealer_owner" && !store) {
    return NextResponse.json({ error: "store is required for a Dealer Owner report" }, { status: 400 });
  }

  const p_city = reportType === "brand_manager" ? city : null;
  const p_store = reportType === "dealer_owner" ? store : null;

  const { year: prevYear, month: prevMonthName } = prevMonth(year, month);

  const [{ data: current, error: curErr }, { data: previous }] = await Promise.all([
    supabase.rpc("dashboard_summary", { p_year: year, p_quarter: null, p_month: month, p_week: null, p_city, p_store }),
    supabase.rpc("dashboard_summary", { p_year: prevYear, p_quarter: null, p_month: prevMonthName, p_week: null, p_city, p_store }),
  ]);
  if (curErr || !current) {
    return NextResponse.json({ error: curErr?.message || "No data for this period" }, { status: 400 });
  }

  const scopeLabel = reportType === "ceo" ? "Company-wide" : reportType === "brand_manager" ? (city as string) : (store as string);

  const buffer = await renderToBuffer(
    MonthlyReportDocument({
      reportType,
      scopeLabel,
      monthLabel: `${month} ${year}`,
      generatedAt: new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }),
      current: current as Summary,
      previous: (previous as Summary) || null,
    })
  );

  const filenameSafe = scopeLabel.replace(/[^a-z0-9]+/gi, "-");
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportType}-${filenameSafe}-${month}-${year}.pdf"`,
    },
  });
}
