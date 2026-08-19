import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";

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
 * Still NOT implemented (unchanged from Etapa 1, still future work):
 *  - Tenant resolution — reading/revalidating `vexo_active_tenant`
 *    (dashboard/master) or resolving host -> tenant_id via `domains`
 *    (storefront), architecture §3.2.1/§3.4. Etapa 3 has no dashboard or
 *    storefront route yet.
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

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every route except static assets and Next's internals.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
