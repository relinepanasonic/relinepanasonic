import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { WORKSPACES } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/erp/upload-log?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Read-only feed for the accounting ERP (accounting.profesoronline.id): what each person uploaded on the Upload page, per day,
// across ALL workspaces, plus the roster of Admins (role client_admin) so the ERP can flag who did NOT upload.
//   - Auth: "Authorization: Bearer <ERP_API_KEY>" only (never the query string); unset env var -> always 401.
//   - from / to: inclusive calendar days in Asia/Jakarta (+07:00), at most 60 days.
//   - Uploads are grouped like the Upload page history (workspace + type + store + month + uploader); bulk re-imports (no
//     meta.bulan) stay one entry each. Names only: no file contents, storage URLs or e-mail addresses leave this endpoint.

const MAX_RANGE_DAYS = 60;
const JAKARTA_OFFSET = "+07:00"; // WIB, fixed, no DST
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 1000;
const NO_STORE = { "Cache-Control": "no-store" };

// The names the Upload page shows (BADGES in upload/page.tsx).
const TYPE_LABEL: Record<string, string> = {
  perf: "Performa", spos: "SPOS", ads: "Ads", gmvmax: "GMV Auto", group: "Group Ads",
  finance: "Earning", orders: "Demographic", orders_ship: "Demographic · Shipping",
  retur_cancel: "Order Cancel", retur_failed: "Failed Delivery", retur_return: "Return Refund",
};

type Meta = { store_name?: string; bulan?: string; admin?: string; kind?: string; ads_level?: string } | null;
type UploadRow = { id: string; source: string; filename: string | null; created_at: string; uploaded_by: string | null; meta: Meta };
type Profile = { id: string; role: string; display_name: string | null; workspaces: string[] | null };

function subKey(u: UploadRow): string {
  if (u.source === "retur") return "retur_" + (u.meta?.kind || "return");
  if (u.source !== "ads") return u.source;
  if (u.meta?.kind === "ads_group") return u.meta?.ads_level === "incubation" ? "gmvmax" : "group";
  return "ads";
}

// SHA-256 first, so the comparison is constant-time and a length mismatch leaks nothing.
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}
function checkAuth(req: NextRequest): boolean {
  const expected = process.env.ERP_API_KEY;
  if (!expected) return false;
  const m = /^Bearer\s+(.+)$/.exec((req.headers.get("authorization") || "").trim());
  return !!m && safeEqual(m[1], expected);
}
const jakartaDayStart = (d: string) => new Date(`${d}T00:00:00${JAKARTA_OFFSET}`);
const bad = (error: string) => NextResponse.json({ error }, { status: 400, headers: NO_STORE });

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return new NextResponse(null, { status: 401, headers: NO_STORE });

  const from = req.nextUrl.searchParams.get("from") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return bad("from and to are required, as YYYY-MM-DD");
  const fromUTC = jakartaDayStart(from);
  const toUTCExclusive = new Date(jakartaDayStart(to).getTime() + 86_400_000);
  if (Number.isNaN(fromUTC.getTime()) || Number.isNaN(toUTCExclusive.getTime()) || fromUTC >= toUTCExclusive) return bad("invalid date range");
  if (Math.round((toUTCExclusive.getTime() - fromUTC.getTime()) / 86_400_000) > MAX_RANGE_DAYS) return bad(`range too long, max ${MAX_RANGE_DAYS} days`);

  const shared = createAdminClient(); // profiles + auth are shared (public schema)
  const [profRes, usersRes, ...perWs] = await Promise.all([
    shared.from("profiles").select("id,role,display_name,workspaces"),
    shared.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ...WORKSPACES.map(async (w) => {
      const db = createAdminClient(w.schema);
      const rows: UploadRow[] = [];
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await db.from("uploads")
          .select("id,source,filename,created_at,uploaded_by,meta")
          .gte("created_at", fromUTC.toISOString()).lt("created_at", toUTCExclusive.toISOString())
          .order("created_at", { ascending: false }).range(off, off + PAGE - 1);
        if (error) return { ws: w, error: true, rows };
        rows.push(...((data as UploadRow[]) || []));
        if (!data || data.length < PAGE) break;
      }
      return { ws: w, error: false, rows };
    }),
  ]);
  if (profRes.error || perWs.some((r) => r.error)) return NextResponse.json({ error: "query failed" }, { status: 500, headers: NO_STORE });

  const profiles = (profRes.data as Profile[]) || [];
  const nameOf = new Map(profiles.map((p) => [p.id, p.display_name || ""]));
  const now = Date.now();
  const banned = new Set(((usersRes.data?.users as { id: string; banned_until?: string | null }[]) || [])
    .filter((u) => u.banned_until && new Date(u.banned_until).getTime() > now).map((u) => u.id));

  type Group = { key: string; ws: string; type: string; store: string; month: string; admin: string; latestAt: string; files: string[] };
  const groups = new Map<string, Group>();
  for (const { ws, rows } of perWs) {
    for (const u of rows) {
      const sub = subKey(u);
      const admin = (u.uploaded_by && nameOf.get(u.uploaded_by)) || u.meta?.admin || "Bulk import";
      const bulk = !u.meta?.bulan; // bulk re-import: one entry per file, like the Upload page
      const store = u.meta?.store_name || "", month = u.meta?.bulan || "";
      const key = bulk ? `${ws.id}|${u.id}` : [ws.id, sub, store, month, admin].join("|");
      let g = groups.get(key);
      if (!g) { g = { key, ws: ws.name, type: TYPE_LABEL[sub] || sub, store, month, admin, latestAt: u.created_at, files: [] }; groups.set(key, g); }
      if (u.filename) g.files.push(u.filename);
      if (new Date(u.created_at) > new Date(g.latestAt)) g.latestAt = u.created_at;
    }
  }
  const list = [...groups.values()].sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());

  // Admins: active client_admin profiles, one entry per person (matched by name) with every workspace they may use.
  const wsName = new Map(WORKSPACES.map((w) => [w.id as string, w.name]));
  const adm = new Map<string, { name: string; workspaces: Set<string> }>();
  for (const p of profiles) {
    if (p.role !== "client_admin" || banned.has(p.id)) continue;
    const name = p.display_name || "—";
    const e = adm.get(name) || { name, workspaces: new Set<string>() };
    for (const w of p.workspaces || []) if (wsName.has(w)) e.workspaces.add(wsName.get(w)!);
    adm.set(name, e);
  }
  const admins = [...adm.values()].sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({
    name: a.name,
    workspaces: WORKSPACES.map((w) => w.name).filter((n) => a.workspaces.has(n)),
    stores: [...new Set(list.filter((g) => g.admin === a.name && g.store).map((g) => g.store))].sort(),
  }));

  const uploads = list.map((g) => ({
    id: crypto.createHash("sha1").update(g.key).digest("hex"),
    uploadedAt: new Date(g.latestAt).toISOString(),
    type: g.type, admin: g.admin, workspace: g.ws, store: g.store, month: g.month,
    files: g.files, tags: [g.type],
  }));

  return NextResponse.json({ generatedAt: new Date().toISOString(), timezone: "Asia/Jakarta", admins, uploads }, { status: 200, headers: NO_STORE });
}
