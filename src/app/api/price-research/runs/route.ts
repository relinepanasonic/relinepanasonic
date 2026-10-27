import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSchema } from "@/lib/workspace-server";
import { keyOfUrl, logHint, parseItem, type Platform } from "@/lib/priceResearch";

export const runtime = "nodejs";
export const maxDuration = 60;

type Run = { id: string; client_id: string; platform: Platform; apify_run_id: string; dataset_id: string | null; link_ids: string[]; status: string; started_at: string };
type Link = { id: string; client_id: string; platform: Platform; product_url: string };
const GIVE_UP_MS = 15 * 60_000;                                  // a run that is still going after 15 minutes is stopped
const DONE = new Set(["SUCCEEDED"]);
const DEAD = new Set(["FAILED", "ABORTED", "TIMED-OUT", "TIMING-OUT", "ABORTING"]);

// GET -> the scrape runs that are running (and the ones that finished in the last hour) of the active workspace. For every run that is
// still "running" it asks Apify: when Apify has finished, the results are matched to their links and saved as snapshots, and the run is closed.
// The page calls this every few seconds while a scrape runs. Super Admin and Admin only.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin"].includes(profile.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const token = process.env.APIFY_TOKEN;
  if (!token) return NextResponse.json({ runs: [] });

  const admin = createAdminClient(await currentSchema());
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { data: rows } = await admin.from("price_research_runs").select("id, client_id, platform, apify_run_id, dataset_id, link_ids, status, started_at")
    .or(`status.eq.running,started_at.gte.${since}`).order("started_at", { ascending: false }).limit(30);
  const runs = (rows as Run[]) || [];

  for (const run of runs.filter((r) => r.status === "running")) {
    try {
      const res = await fetch(`https://api.apify.com/v2/actor-runs/${run.apify_run_id}?token=${encodeURIComponent(token)}`);
      if (!res.ok) continue;
      const info = (await res.json()).data as { status: string; defaultDatasetId?: string; statusMessage?: string };
      const age = Date.now() - new Date(run.started_at).getTime();
      // some actors exit with an error code AFTER saving their results (the TikTok Shop actor does): when a run is dead but its dataset has items, use them
      let finished = DONE.has(info.status);
      if (!finished && DEAD.has(info.status)) {
        const dr = await fetch(`https://api.apify.com/v2/datasets/${info.defaultDatasetId || run.dataset_id}?token=${encodeURIComponent(token)}`).catch(() => null);
        finished = !!dr && dr.ok && Number(((await dr.json()) as { data?: { itemCount?: number } }).data?.itemCount) > 0;
      }
      if (finished) {
        const ds = info.defaultDatasetId || run.dataset_id;
        const ir = await fetch(`https://api.apify.com/v2/datasets/${ds}/items?clean=true&token=${encodeURIComponent(token)}`);
        const items = ir.ok ? ((await ir.json()) as Record<string, unknown>[]) : [];
        // Apify says it succeeded but returned nothing: read its log so the page can say why
        let why = "";
        if (!items.length) {
          const lr = await fetch(`https://api.apify.com/v2/actor-runs/${run.apify_run_id}/log?token=${encodeURIComponent(token)}`).catch(() => null);
          const hint = lr && lr.ok ? logHint(await lr.text()) : "";
          why = `Apify returned 0 results.${hint ? ` Log: ${hint}` : ""}`;
        }
        const { data: ls } = await admin.from("price_research_links").select("id, client_id, platform, product_url").in("id", run.link_ids);
        const byKey = new Map(items.map((it) => { const p = parseItem(run.platform, it); return [p.key, p] as const; }));
        const snaps = ((ls as Link[]) || []).map((l) => {
          const p = byKey.get(keyOfUrl(run.platform, l.product_url));
          if (!p || p.price == null) return { client_id: l.client_id, link_id: l.id, ok: false, error: p ? "The result has no price" : (why || "No result for this URL (blocked, sold out or removed)"), run_id: run.apify_run_id };
          return { client_id: l.client_id, link_id: l.id, ok: true, price: p.price, original_price: p.original, sold: p.sold, rating: p.rating, title: p.title, shop_name: p.shop, run_id: run.apify_run_id };
        });
        if (snaps.length) await admin.from("price_research_snapshots").insert(snaps);
        const ok = snaps.filter((s) => s.ok).length;
        await admin.from("price_research_runs").update({ status: "done", scraped: ok, failed: snaps.length - ok, error: why || null, finished_at: new Date().toISOString() }).eq("id", run.id);
      } else if (DEAD.has(info.status) || age > GIVE_UP_MS) {
        if (!DEAD.has(info.status)) await fetch(`https://api.apify.com/v2/actor-runs/${run.apify_run_id}/abort?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => null);
        const msg = DEAD.has(info.status) ? `Apify run ${info.status.toLowerCase()}${info.statusMessage ? `: ${info.statusMessage}` : ""}` : "Apify took longer than 15 minutes and was stopped";
        const { data: ls } = await admin.from("price_research_links").select("id, client_id").in("id", run.link_ids);
        const bad = ((ls as { id: string; client_id: string }[]) || []).map((l) => ({ client_id: l.client_id, link_id: l.id, ok: false, error: msg, run_id: run.apify_run_id }));
        if (bad.length) await admin.from("price_research_snapshots").insert(bad);
        await admin.from("price_research_runs").update({ status: "failed", failed: bad.length, error: msg, finished_at: new Date().toISOString() }).eq("id", run.id);
      }
    } catch { /* try again on the next poll */ }
  }

  const { data: fresh } = await admin.from("price_research_runs").select("id, platform, status, scraped, failed, error, started_at, finished_at, link_ids")
    .or(`status.eq.running,started_at.gte.${since}`).order("started_at", { ascending: false }).limit(30);
  return NextResponse.json({ runs: ((fresh as Record<string, unknown>[]) || []).map((r) => ({ ...r, links: (r.link_ids as string[]).length, link_ids: undefined })) });
}
