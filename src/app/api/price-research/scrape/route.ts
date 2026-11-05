import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";
import { actorFor, buildInput, cleanUrl, PLATFORMS, type Platform } from "@/lib/priceResearch";

export const runtime = "nodejs";
export const maxDuration = 60;

type Link = { id: string; client_id: string; platform: Platform; product_url: string };
const MAX_LINKS = 600;

// POST { connection_ids: string[] } (or { link_ids }) -> STARTS the scrape of those competitor links on Apify and returns at once (one Apify run per marketplace).
// The page then polls GET /api/price-research/runs, which saves the prices as snapshots when Apify has finished; a scrape can take minutes,
// far more than a request may wait. Super Admin and Admin only. Needs APIFY_TOKEN (Vercel env). None of the actors needs a marketplace login.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role, display_name").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin"].includes(profile.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const token = process.env.APIFY_TOKEN;
  if (!token) return NextResponse.json({ error: "APIFY_TOKEN is not set. Add it in the Vercel environment variables (see .env.example) and redeploy." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { link_ids?: string[]; connection_ids?: string[] };
  const admin = createAdminClient(await currentSchema());
  // the scrape of one or more store connections: every Product URL of those connections
  const connIds = Array.from(new Set((body.connection_ids || []).filter((x) => typeof x === "string")));
  let linkIds = (body.link_ids || []).filter((x) => typeof x === "string");
  if (connIds.length) {
    const { data: cl, error: cerr } = await admin.from("price_research_links").select("id").in("connection_id", connIds);
    if (cerr) return NextResponse.json({ error: cerr.message }, { status: 500 });
    linkIds = ((cl as { id: string }[]) || []).map((x) => x.id);
  }
  const ids = Array.from(new Set(linkIds)).slice(0, MAX_LINKS);
  if (!ids.length) return NextResponse.json({ error: connIds.length ? "These connections have no Product URL yet." : "Pick at least one link." }, { status: 400 });

  const { data: rows, error: lerr } = await admin.from("price_research_links").select("id, client_id, platform, product_url").in("id", ids);
  if (lerr) return NextResponse.json({ error: lerr.message }, { status: 500 });
  const links = (rows as Link[]) || [];
  if (!links.length) return NextResponse.json({ error: "No such links." }, { status: 404 });

  // the scrape log: one row per Execute, the Apify runs below point at it
  let scrapeId: string | null = null;
  if (connIds.length) {
    const { data: sc } = await admin.from("pr_scrapes").insert({ client_id: links[0].client_id, connection_ids: connIds, links: links.length, created_by: (profile as { display_name?: string }).display_name ?? null }).select("id").single();
    scrapeId = (sc as { id: string } | null)?.id ?? null;
  }

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
    try {
      const res = await fetch(`https://api.apify.com/v2/acts/${actorFor(platform)}/runs?token=${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildInput(platform, Array.from(new Set(todo.map((l) => cleanUrl(l.product_url)))))),
      });
      if (!res.ok) { const msg = `Apify ${res.status}: ${(await res.text()).slice(0, 200)}`; todo.forEach((l) => failLink(l, msg)); continue; }
      const run = (await res.json()).data as { id: string; defaultDatasetId?: string };
      const { error } = await admin.from("price_research_runs").insert({
        client_id: todo[0].client_id, platform, apify_run_id: run.id, dataset_id: run.defaultDatasetId ?? null, link_ids: todo.map((l) => l.id), scrape_id: scrapeId,
      });
      if (error) { todo.forEach((l) => failLink(l, error.message)); continue; }
      started.push({ platform, links: todo.length });
    } catch (e) { todo.forEach((l) => failLink(l, String(e))); }
  }
  if (failedSnaps.length) await admin.from("price_research_snapshots").insert(failedSnaps);

  return NextResponse.json({ ok: true, scrape_id: scrapeId, started, failed: failedSnaps.length, errors: Array.from(new Set(failedSnaps.map((s) => String(s.error)))).slice(0, 5) });
}
