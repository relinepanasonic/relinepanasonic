import crypto from "crypto";
import type { NextRequest } from "next/server";

// Shared by the read-only feeds for the accounting ERP (/api/erp/*).
//   "Authorization: Bearer <ERP_API_KEY>" only (never the query string); an unset env var means every call is refused.
//   The comparison hashes both sides with SHA-256 first, so it is constant-time and a length mismatch leaks nothing.

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function checkErpAuth(req: NextRequest): boolean {
  const expected = process.env.ERP_API_KEY;
  if (!expected) return false;
  const m = /^Bearer\s+(.+)$/.exec((req.headers.get("authorization") || "").trim());
  return !!m && safeEqual(m[1], expected);
}

export const ERP_NO_STORE = { "Cache-Control": "no-store" };
