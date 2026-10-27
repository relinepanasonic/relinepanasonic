import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";
import { actorFor, buildInput, cleanUrl, PLATFORMS, type Platform } from "@/lib/priceResearch";

export const runtime = "nodejs";
export const maxDuration = 60;

type Link = { id: string; client_id: string; platform: Platform; product_url: string };
const MAX_LINKS = 150;

// POST { link_ids: string[] } -> STARTS the scrape of those competitor links on Apify and returns at once (one Apify run per marketplace).
// The page then polls GET /api/price-research/runs, which saves the prices as snapshots when Apify has finished; a scrape can take minutes,
// far more than a request may wait. Super Admin and Admin only. Needs APIFY_TOKEN (Vercel env); the Shopee actor also needs APIFY_SHOPEE_COOKIE.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin"].includes(profile.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const token = process.env.APIFY_TOKEN;
  if (!token) return NextResponse.json({ error: "APIFY_TOKEN is not set. Add it in the Vercel environment variables (see .env.example) and redeploy." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { link_ids?: string[] };
  const ids = Array.from(new Set((body.link_ids || []).filter((x) => typeof x === "string"))).slice(0, MAX_LINKS);
  if (!ids.length) return NextResponse.json({ error: "Pick at least one link." }, { status: 400 });

  const admin = createAdminClient(await currentSchema());
  const { data: rows, error: lerr } = await admin.from("price_research_links").select("id, client_id, platform, product_url").in("id", ids);
  if (lerr) return NextResponse.json({ error: lerr.message }, { status: 500 });
  const links = (rows as Link[]) || [];
  if (!links.length) return NextResponse.json({ error: "No such links." }, { status: 404 });

  const failedSnaps: Record<string, unknown>[] = [];
  const failLink = (l: Link, error: string) => failedSnaps.push({ client_id: l.client_id, link_id: l.id, ok: false, error });
  const started: { platform: Platform; links: number }[] = [];

  for (const { v: platform } of PLATFORMS) {
    const group = links.filter((l) => l.platform === platform);
    if (!group.length) continue;
    // a scrape already running for the same links is not started twice
    const { data: running } = await admin.from("price_research_runs").select("link_ids").eq("platform", platform).eq("status", "running");
    const busy = new Set(((running as { link_ids: string[] }[]) || []).flatMap((r) => r.link_ids));
    const todo = group.filter((l) => !busy.has(l.id));
    if (!todo.length) { started.push({ platform, links: 0 }); continue; }
    if (platform === "shopee" && !process.env.APIFY_SHOPEE_COOKIE) {
      todo.forEach((l) => failLink(l, "APIFY_SHOPEE_COOKIE is not set (the Shopee actor needs a Shopee login cookie)"));
      continue;
    }
    try {
      const res = await fetch(`https://api.apify.com/v2/acts/${actorFor(platform)}/runs?token=${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildInput(platform, todo.map((l) => cleanUrl(l.product_url)))),
      });
      if (!res.ok) { const msg = `Apify ${res.status}: ${(await res.text()).slice(0, 200)}`; todo.forEach((l) => failLink(l, msg)); continue; }
      const run = (await res.json()).data as { id: string; defaultDatasetId?: string };
      const { error } = await admin.from("price_research_runs").insert({
        client_id: todo[0].client_id, platform, apify_run_id: run.id, dataset_id: run.defaultDatasetId ?? null, link_ids: todo.map((l) => l.id),
      });
      if (error) { todo.forEach((l) => failLink(l, error.message)); continue; }
      started.push({ platform, links: todo.length });
    } catch (e) { todo.forEach((l) => failLink(l, String(e))); }
  }
  if (failedSnaps.length) await admin.from("price_research_snapshots").insert(failedSnaps);

  return NextResponse.json({ ok: true, started, failed: failedSnaps.length, errors: Array.from(new Set(failedSnaps.map((s) => String(s.error)))).slice(0, 5) });
}
