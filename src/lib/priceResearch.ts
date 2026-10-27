// Price Research: competitor price scraping through Apify (Price Calculator > Price Research).
// One Apify "actor" per marketplace. The actor ids can be replaced with env vars (APIFY_ACTOR_SHOPEE / _TOKOPEDIA / _TIKTOK) the day a
// better actor is found; only buildInput / parseItem / the two key functions below know an actor's input and output format.
//   shopee     lergassy/shopee-scraper         no login / cookie needed (tested: price, original price, rating, seller in 7 s for $0.0007)
//   tokopedia  khadinakbar/tokopedia-scraper   product-detail URLs
//   tiktok     kulqiz/tiktok-shop-scraper      TikTok Shop Indonesia (shop-id.tokopedia.com) product URLs

export type Platform = "shopee" | "tokopedia" | "tiktok";
export const PLATFORMS: { v: Platform; label: string; hint: string; estPerResult: number }[] = [
  { v: "shopee", label: "Shopee", hint: "https://shopee.co.id/…-i.<shop>.<item>", estPerResult: 0.001 },
  { v: "tokopedia", label: "Tokopedia", hint: "https://www.tokopedia.com/<shop>/<product>", estPerResult: 0.005 },
  { v: "tiktok", label: "TikTok Shop", hint: "https://shop-id.tokopedia.com/pdp/…/<product id>", estPerResult: 0.001 },
];

export const DEFAULT_ACTORS: Record<Platform, string> = {
  shopee: "lergassy~shopee-scraper",
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

export function buildInput(p: Platform, urls: string[]): Record<string, unknown> {
  if (p === "shopee") return { mode: "product", country: "ID", startUrls: urls, maxItems: urls.length };
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

export type Parsed = { key: string | null; price: number | null; original: number | null; sold: number | null; rating: number | null; title: string | null; shop: string | null;
  labels?: string[] | null; discount?: number | null; location?: string | null };
const strList = (v: unknown): string[] | null => Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : null;
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
    const seller = (it.seller ?? {}) as Record<string, unknown>;
    return {
      key: str(it.itemId) ?? keyOfUrl("shopee", String(it.url ?? "")),
      price: rupiah(toNum(it.price ?? it.displayPrice)), original: rupiah(toNum(it.originalPrice)),
      sold: toNum(it.sold ?? it.totalSales), rating: toNum(it.rating), title: str(it.title ?? it.name), shop: str(seller.name ?? it["seller.name"] ?? it.shopName),
      labels: strList(it.labels), discount: toNum(it.discountPercent), location: str(it.location),
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
    title: str(it.title), shop: str(it.shop_name), discount: toNum(it.discount),
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

// The marketplace of a product URL, so nobody has to pick it by hand (null = not a Shopee / Tokopedia / TikTok Shop link).
export function detectPlatform(url: string): Platform | null {
  let host = "";
  try { host = new URL(url.trim()).hostname.toLowerCase(); } catch { return null; }
  if (host === "shopee.co.id" || host.endsWith(".shopee.co.id")) return "shopee";
  if (host.endsWith("tiktok.com") || host === "shop-id.tokopedia.com") return "tiktok";   // TikTok Shop Indonesia lives on a tokopedia.com sub-domain
  if (host === "tokopedia.com" || host.endsWith(".tokopedia.com")) return "tokopedia";
  return null;
}
