import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16: the old `middleware.ts` convention is renamed to `proxy.ts`.
// Refreshes the Supabase session on every request and guards protected routes.

// ── Module-level JWKS cache ──────────────────────────────────────────
// The auth check below uses getClaims(), which verifies the JWT's ES256
// signature LOCALLY (via WebCrypto) instead of round-tripping to Supabase's
// auth server the way getUser() does. auth-js caches the JWKS per client
// instance, but the proxy creates a fresh client per request — so we cache
// the JWKS here at module scope (shared across warm requests) and hand it to
// getClaims, which then skips the per-request network fetch entirely.
const JWKS_TTL_MS = 10 * 60 * 1000; // 10 min — long enough to matter, short enough to pick up key rotation
let jwksCache: { keys: unknown[] } | null = null;
let jwksFetchedAt = 0;

async function getCachedJwks(): Promise<{ keys: unknown[] } | null> {
  const now = Date.now();
  if (jwksCache && now - jwksFetchedAt < JWKS_TTL_MS) return jwksCache;
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } }
    );
    if (res.ok) {
      const data = (await res.json()) as { keys: unknown[] };
      if (data?.keys?.length) {
        jwksCache = data;
        jwksFetchedAt = now;
      }
    }
  } catch {
    // Network hiccup fetching the JWKS — fall through with whatever we have
    // (possibly null). getClaims then falls back to its own fetch/verify, so
    // correctness is preserved; we just lose the cache win for this request.
  }
  return jwksCache;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() reads the session from the cookie (refreshing it if the access
  // token expired — same as getUser), then verifies the ES256 signature +
  // expiry LOCALLY using the module-cached JWKS. This keeps the guard secure
  // (forged/tampered/expired tokens are rejected) while removing the network
  // round-trip getUser() makes on every request. Tradeoff: a token revoked
  // mid-session stays valid until it expires (≤1h) — acceptable for an
  // internal dashboard route guard.
  // getClaims throws (rather than returning an error) on a structurally
  // malformed token — treat any failure as "not authenticated" so a corrupt
  // cookie yields a clean redirect to /login, never a 500.
  let authed = false;
  try {
    const jwks = await getCachedJwks();
    const { data } = await supabase.auth.getClaims(
      undefined,
      jwks ? { keys: jwks.keys as never } : undefined
    );
    authed = !!data?.claims;
  } catch {
    authed = false;
  }

  const path = request.nextUrl.pathname;
  const isAuthPage   = path === "/login";
  const isPublicPage = isAuthPage || path.startsWith("/join/");

  if (!authed && !isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (authed && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Exclude:
  //  - `api` — every protected API route self-authenticates (getUser + role
  //    check), and /api/join is intentionally public; running the proxy guard
  //    on them too is redundant, and a 307→/login redirect is the wrong reply
  //    to an API call (the handlers return proper JSON 401/403 themselves).
  //  - Next internals + public static assets (images, manifest, robots, etc.)
  //    so they're served directly instead of redirected to /login — the same
  //    bug class that once broke /join/* invite links.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|webmanifest|txt|xml)$).*)"],
};
