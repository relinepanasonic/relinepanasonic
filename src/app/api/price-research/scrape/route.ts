import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";
import { actorFor, buildInput, keyOfUrl, parseItem, PLATFORMS, type Platform } from "@/lib/priceResearch";

export const runtime = "nodejs";
export const maxDuration = 300;

type Link = { id: string; client_id: string; platform: Platform; product_url: string };
const MAX_LINKS = 150;

// POST { link_ids: string[] } -> scrapes the competitor price of those links NOW (on demand) through Apify and saves one snapshot per link.
// Super Admin and Admin only. Needs APIFY_TOKEN (Vercel env); the Shopee actor also needs APIFY_SHOPEE_COOKIE.
// A link whose result is missing or blocked gets a failed snapshot (ok = false): it never replaces the last good price.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin"].includes(profile.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const token = process.env.APIFY_TOKEN;
  if (!token) return NextResponse.json({ error: "APIFY_TOKEN is not set. Add it in the Vercel environment variables (see .env.example)." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { link_ids?: string[] };
  const ids = Array.from(new Set((body.link_ids || []).filter((x) => typeof x === "string"))).slice(0, MAX_LINKS);
  if (!ids.length) return NextResponse.json({ error: "Pick at least one link." }, { status: 400 });

  const admin = createAdminClient(await currentSchema());
  const { data: rows, error: lerr } = await admin.from("price_research_links").select("id, client_id, platform, product_url").in("id", ids);
  if (lerr) return NextResponse.json({ error: lerr.message }, { status: 500 });
  const links = (rows as Link[]) || [];
  if (!links.length) return NextResponse.json({ error: "No such links." }, { status: 404 });

  type Snap = { client_id: string; link_id: string; ok: boolean; error: string | null; price: number | null; original_price: number | null; sold: number | null;
    rating: number | null; title: string | null; shop_name: string | null; run_id: string | null };
  const snaps: Snap[] = [];
  const fail = (l: Link, error: string): Snap => ({ client_id: l.client_id, link_id: l.id, ok: false, error, price: null, original_price: null, sold: null, rating: null, title: null, shop_name: null, run_id: null });

  for (const { v: platform } of PLATFORMS) {
    const group = links.filter((l) => l.platform === platform);
    if (!group.length) continue;
    if (platform === "shopee" && !process.env.APIFY_SHOPEE_COOKIE) {
      group.forEach((l) => snaps.push(fail(l, "APIFY_SHOPEE_COOKIE is not set (the Shopee actor needs a Shopee login cookie)")));
      continue;
    }
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 270_000);
      const res = await fetch(`https://api.apify.com/v2/acts/${actorFor(platform)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify(buildInput(platform, group.map((l) => l.product_url))),
      }).finally(() => clearTimeout(timer));
      const runId = res.headers.get("x-apify-run-id");
      if (!res.ok) {
        const msg = `Apify ${res.status}: ${(await res.text()).slice(0, 200)}`;
        group.forEach((l) => snaps.push(fail(l, msg)));
        continue;
      }
      const items = (await res.json()) as Record<string, unknown>[];
      const byKey = new Map(items.map((it) => { const p = parseItem(platform, it); return [p.key, p] as const; }));
      for (const l of group) {
        const p = byKey.get(keyOfUrl(platform, l.product_url));
        if (!p || p.price == null) { snaps.push(fail(l, p ? "The result has no price" : "No result for this URL (blocked, sold out or removed)")); continue; }
        snaps.push({ client_id: l.client_id, link_id: l.id, ok: true, error: null, price: p.price, original_price: p.original, sold: p.sold, rating: p.rating, title: p.title, shop_name: p.shop, run_id: runId });
      }
    } catch (e) {
      const msg = e instanceof Error && e.name === "AbortError" ? "Apify did not answer in time" : String(e);
      group.forEach((l) => snaps.push(fail(l, msg)));
    }
  }

  const { error: ierr } = await admin.from("price_research_snapshots").insert(snaps);
  if (ierr) return NextResponse.json({ error: ierr.message }, { status: 500 });
  return NextResponse.json({
    ok: true, scraped: snaps.filter((s) => s.ok).length, failed: snaps.filter((s) => !s.ok).length,
    errors: Array.from(new Set(snaps.filter((s) => !s.ok).map((s) => s.error))).slice(0, 5),
  });
}
