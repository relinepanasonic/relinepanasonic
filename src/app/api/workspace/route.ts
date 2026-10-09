import { NextRequest, NextResponse } from "next/server";
import { WORKSPACE_COOKIE, isWorkspaceId } from "@/lib/workspace";

// GET /api/workspace?ws=gobel|light — remember the chosen workspace, then go
// to the app. Session cookie (no max-age): every new browser session starts
// on the /welcome chooser. Readable by JS on purpose — the browser Supabase
// client needs it to pick the right schema.
export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get("ws");
  if (!isWorkspaceId(ws)) return NextResponse.redirect(new URL("/welcome", req.url));
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(WORKSPACE_COOKIE, ws, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
