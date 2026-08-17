import { NextResponse, type NextRequest } from "next/server";

/**
 * Foundation-stage Proxy (renamed from "Middleware" in Next.js 16 — see
 * https://nextjs.org/docs/app/api-reference/file-conventions/proxy):
 * passthrough only. No auth, no tenant resolution, no rate limiting yet —
 * those are business rules and this stage is explicitly scoped to not
 * invent them (architecture §24, Etapa 1). The architecture doc's own
 * references to "middleware.ts" (§3.2.1, §7, §19) map to this file.
 *
 * Extension points for later stages, per the approved architecture:
 *
 *  - Stage 3 (auth): refresh the Supabase session cookie here via
 *    `createServerClient` from `@supabase/ssr`, using a request/response
 *    cookie adapter (architecture §7).
 *  - Stage 3/6: resolve the active tenant —
 *      · dashboard/master routes: read + revalidate the signed
 *        `vexo_active_tenant` cookie against `tenant_members`
 *        (architecture §3.2.1) — the cookie is UI context only, never an
 *        authorization decision.
 *      · storefront routes: resolve `host -> tenant_id` via `domains`
 *        (architecture §3.4) and inject it into the request context; never
 *        accept a tenant id from the client.
 *  - Later stages: rate limiting on public/API routes (architecture §10,
 *    §18).
 *
 * None of that is implemented here yet.
 */
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run on every route except static assets and Next's internals, so the
     * matcher shape is already correct for when session/tenant resolution
     * is added — without executing any logic yet.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
