import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isReservedDomain } from "@/features/settings/domain-schema";
import { resolveTenantByHost } from "@/features/storefront/resolve-tenant-by-host";
import { getPublicEnv } from "@/lib/env";
import { normalizeHost } from "@/lib/security/host-normalization";
import { isStorefrontPath } from "@/lib/security/storefront-path-allowlist";

/**
 * Proxy (renamed from "Middleware" in Next.js 16 — see
 * https://nextjs.org/docs/app/api-reference/file-conventions/proxy). The
 * architecture doc's references to "middleware.ts" (§3.2.1, §7, §19) map
 * to this file.
 *
 * Etapa 3 implements the session-refresh extension point Etapa 1 reserved
 * here (architecture §7): Server Components can't write cookies, so the
 * Supabase session's access/refresh tokens need refreshing somewhere that
 * can — this file, on every request, following Supabase's standard SSR
 * pattern for Next.js.
 *
 * D17.4.2 — Host Routing (auditoria D17.4.0, fundação D17.4.1) added below
 * the session refresh, never replacing it: every request still gets its
 * session refreshed first, exactly as before; Host Routing only decides,
 * afterwards, whether THIS response should become a rewrite to
 * `/loja/[slug]` instead of `NextResponse.next()`. It grants no
 * authorization by itself — `resolveTenantByHost` only ever returns a
 * `slug` already gated by `tenant_domains.status = 'active'` AND
 * `tenants.status = 'active'` (D17.4.1), and every subsequent RLS/session
 * check for `/painel`, `/master`, `/api` keeps working completely
 * unchanged (Host Routing never reaches those paths — see the allowlist
 * check below).
 *
 * Still NOT implemented (still future work, out of D17.4.2's scope):
 *  - `vexo_active_tenant` reading/revalidation for the painel/master
 *    dashboards (architecture §3.2.1) — unrelated to storefront Host
 *    Routing.
 *  - Rate limiting on public/API routes (architecture §10, §18).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
    getPublicEnv();

  const supabase = createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the access token if it's expired, and re-sets the session
  // cookies via setAll above when it does — required so Server
  // Components (which cannot set cookies themselves) always see a valid
  // session instead of intermittently expiring mid-navigation.
  await supabase.auth.getUser();

  return (await maybeRewriteToStorefront(request, response)) ?? response;
}

/**
 * D17.4.2 — decides whether `request` should be rewritten to
 * `/loja/[slug]`. Returns `null` (never a bare `false`/`undefined` typed
 * loosely) whenever the request should just continue normally — every
 * failure mode here is fail-open by design (ticket Part 11): invalid/
 * missing/reserved host, domain not `active`, tenant not `active`, or any
 * unexpected resolver error all fall through to `null`, never throwing,
 * never blocking the request.
 *
 * Order of checks matches ticket Part 12 (cheapest first, so `/painel`,
 * `/master`, `/api`, assets, and requests to the VEXO domains themselves
 * never trigger a `tenant_domains` query):
 *   1. pathname — allowlist (cheapest, pure, in-memory);
 *   2. host — read once from the request;
 *   3. normalize + reserved-domain check (still pure, in-memory);
 *   4. `resolveTenantByHost` — the only step that touches the database.
 */
async function maybeRewriteToStorefront(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;

  // Never re-resolve a request already targeting /loja/... — this is both
  // the anti-loop guard (Part 7) and already implied by the allowlist
  // below (no storefront pattern starts with "/loja"), kept explicit here
  // on purpose.
  if (pathname.startsWith("/loja/") || !isStorefrontPath(pathname)) {
    return null;
  }

  const host = normalizeHost(request.headers.get("host"));
  if (!host || isReservedDomain(host)) {
    return null;
  }

  const resolution = await resolveTenantByHost(host);
  if (resolution.status !== "ready") {
    return null;
  }

  // `slug` is always DB-constrained to `^[a-z0-9]+(-[a-z0-9]+)*$`
  // (`tenants_slug_format`, migration 20260817220004) — never contains
  // "/" or any character that could escape the pathname it's interpolated
  // into.
  const url = request.nextUrl.clone();
  url.pathname = `/loja/${resolution.slug}${pathname === "/" ? "" : pathname}`;

  const rewritten = NextResponse.rewrite(url);
  // Preserve the session cookies already refreshed above — a rewrite must
  // never silently drop the Supabase session cookies set on `response`.
  for (const cookie of response.cookies.getAll()) {
    rewritten.cookies.set(cookie);
  }
  return rewritten;
}

export const config = {
  matcher: [
    /*
     * Run on every route except static assets and Next's internals.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
