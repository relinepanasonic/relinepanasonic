// Price Research: competitor price scraping through Apify (Price Calculator > Price Research).
// One Apify "actor" per marketplace. The actor ids can be replaced with env vars (APIFY_ACTOR_SHOPEE / _TOKOPEDIA / _TIKTOK) the day a
// better actor is found; only buildInput / parseItem / the two key functions below know an actor's input and output format.
//   shopee     enrico_7/shopee-scraper         needs a Shopee login cookie (APIFY_SHOPEE_COOKIE, it expires every 1-2 days)
//   tokopedia  khadinakbar/tokopedia-scraper   product-detail URLs
//   tiktok     kulqiz/tiktok-shop-scraper      TikTok Shop Indonesia (shop-id.tokopedia.com) product URLs

export type Platform = "shopee" | "tokopedia" | "tiktok";
export const PLATFORMS: { v: Platform; label: string; hint: string; estPerResult: number }[] = [
  { v: "shopee", label: "Shopee", hint: "https://shopee.co.id/…-i.<shop>.<item>", estPerResult: 0.01 },
  { v: "tokopedia", label: "Tokopedia", hint: "https://www.tokopedia.com/<shop>/<product>", estPerResult: 0.005 },
  { v: "tiktok", label: "TikTok Shop", hint: "https://shop-id.tokopedia.com/pdp/…/<product id>", estPerResult: 0.001 },
];

export const DEFAULT_ACTORS: Record<Platform, string> = {
  shopee: "enrico_7~shopee-scraper",
  tokopedia: "khadinakbar~tokopedia-scraper",
  tiktok: "kulqiz~tiktok-shop-scraper",
};
export function actorFor(p: Platform, env: Record<string, string | undefined> = process.env): string {
  const override = env[`APIFY_ACTOR_${p.toUpperCase()}`];
  return (override || DEFAULT_ACTORS[p]).replace("/", "~");
}

// A product URL must belong to its marketplace.
export function urlMatchesPlatform(p: Platform, url: string): boolean {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  if (p === "shopee") return host === "shopee.co.id" || host.endsWith(".shopee.co.id");
  if (p === "tokopedia") return host === "tokopedia.com" || host.endsWith(".tokopedia.com");
  return host.endsWith("tiktok.com") || host === "shop-id.tokopedia.com" || host.endsWith(".tokopedia.com");
}

export function buildInput(p: Platform, urls: string[], env: Record<string, string | undefined> = process.env): Record<string, unknown> {
  if (p === "shopee") return { mode: "product_detail", urls, region: "id", maxItems: urls.length, cookie: buyerCookie(env.APIFY_SHOPEE_COOKIE) };
  if (p === "tokopedia") return { startUrls: urls, maxResults: urls.length, proxyConfiguration: { useApifyProxy: true } };
  return { productUrls: urls, includeReviews: false };
}

// ── matching a result to the link it came from ──────────────────────────────────────────────
const digits = (v: unknown) => { const m = String(v ?? "").match(/\d{6,}/g); return m ? m[m.length - 1] : null; };
export function keyOfUrl(p: Platform, url: string): string | null {
  if (!url) return null;
  if (p === "shopee") {
    const a = url.match(/-i\.(\d+)\.(\d+)/) || url.match(/\/product\/(\d+)\/(\d+)/);
    return a ? a[2] : null;
  }
  if (p === "tokopedia") {
    try { return new URL(url).pathname.replace(/\/+$/, "").toLowerCase() || null; } catch { return null; }
  }
  try { return digits(new URL(url).pathname); } catch { return digits(url); }
}

export type Parsed = { key: string | null; price: number | null; original: number | null; sold: number | null; rating: number | null; title: string | null; shop: string | null };
type Item = Record<string, unknown>;
const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/rp/i, "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return null;
  const n = Number(s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));   // "1.250.000" and "1.250.000,50"
  return Number.isFinite(n) ? n : null;
};
// some actors return Shopee's internal money unit (price x 100,000): bring it back to rupiah
const rupiah = (n: number | null) => (n != null && n > 1e9 ? Math.round(n / 100_000) : n);
const str = (v: unknown) => (v == null || v === "" ? null : String(v));

export function parseItem(p: Platform, it: Item): Parsed {
  if (p === "shopee") {
    return {
      key: str(it.itemId) ?? keyOfUrl("shopee", String(it.url ?? "")),
      price: rupiah(toNum(it.priceMin ?? it.price)), original: rupiah(toNum(it.originalPrice)),
      sold: toNum(it.totalSales ?? it.sold), rating: toNum(it.ratingAverage ?? it.rating), title: str(it.name ?? it.title), shop: str(it.shopName),
    };
  }
  if (p === "tokopedia") {
    return {
      key: keyOfUrl("tokopedia", String(it.url ?? "")),
      price: toNum(it.priceInt ?? it.price), original: toNum(it.originalPriceInt ?? it.originalPrice ?? it.priceBeforeDiscount),
      sold: toNum(it.sold ?? it.soldCount ?? it.totalSold), rating: toNum(it.rating), title: str(it.name ?? it.title), shop: str(it.shopName),
    };
  }
  return {
    key: str(it.product_id) ? String(it.product_id) : keyOfUrl("tiktok", String(it.url ?? "")),
    price: toNum(it.sale_price_value ?? it.sale_price), original: toNum(it.origin_price), sold: toNum(it.sold_count), rating: toNum(it.rating),
    title: str(it.title), shop: str(it.shop_name),
  };
}

export function estimateCost(counts: Partial<Record<Platform, number>>): number {
  return PLATFORMS.reduce((a, x) => a + (counts[x.v] || 0) * x.estPerResult, 0);
}

// A pasted product URL carries tracking junk (?extraParams=…&image_ids=…): keep the address only (TikTok Shop links keep their path)
export function cleanUrl(url: string): string {
  try { const u = new URL(url.trim()); return `${u.origin}${u.pathname}`; } catch { return url.trim(); }
}

// Why did an actor that "succeeded" return nothing? The run log usually says (login needed, blocked, captcha ...): keep the few telling lines,
// with every cookie-looking value removed (the log can echo the input).
export function logHint(log: string): string {
  const clean = log.replace(/\u001b\[[0-9;]*m/g, "").replace(/SPC_[A-Z_]*=[^;\s"']+/g, "SPC_…=[hidden]").replace(/\b(cookie["']?\s*[:=]\s*)["']?[^"'\n]{20,}/gi, "$1[hidden]");
  const lines = clean.split(/\r?\n/).map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T\S+\s+/, "").trim()).filter(Boolean);
  const telling = lines.filter((l) => /error|warn|cookie|login|log in|blocked|captcha|forbidden|403|429|no results|0 results|failed|denied|expired/i.test(l));
  return (telling.length ? telling : lines).slice(-3).join(" · ").slice(0, 400);
}
// A Shopee login cookie carries SPC_EC (the login token); without it the actor sees a logged-out visitor and usually returns nothing.
export const shopeeCookieLooksLoggedIn = (cookie: string | undefined) =>
  !!cookie && (/(^|;\s*)SPC_(EC|ST)=[^;\s]{10,}/.test(cookie) || /(^|;\s*)SPC_U=\d+/.test(cookie));   // SPC_EC is not always present

// The scraper only needs the BUYER session. A cookie copied from a browser that is also signed in to Seller Centre carries the seller
// session (SPC_SC_*): those cookies are never sent to Apify.
export function buyerCookie(cookie: string | undefined): string {
  return (cookie || "").split(";").map((c) => c.trim()).filter((c) => c && !/^SPC_SC_/i.test(c)).join("; ");
}

// The NAMES of the cookies (never the values) in a saved cookie string, so a wrong paste can be diagnosed without showing a secret.
export function cookieNames(cookie: string | undefined): string[] {
  return (cookie || "").split(";").map((c) => c.split("=")[0].trim()).filter(Boolean);
}
export function cookieNote(cookie: string | undefined): string {
  if (!cookie) return " APIFY_SHOPEE_COOKIE is empty in this deployment (set it in Vercel and redeploy).";
  const names = cookieNames(cookie);
  const login = names.filter((n) => /^SPC_(EC|ST)$/.test(n));
  if (login.length) return ` The saved cookie has ${names.length} cookies including ${login.join(", ")}, so it looks logged in: it may have expired or Shopee blocked this request.`;
  return ` The saved cookie has ${names.length} cookies (${names.filter((n) => n.startsWith("SPC_")).slice(0, 8).join(", ") || "no SPC_ ones"}) but no login token (SPC_EC / SPC_ST): it was copied while logged out, or Vercel was not redeployed after you changed it.`;
}
