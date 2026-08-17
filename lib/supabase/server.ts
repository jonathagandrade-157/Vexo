import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getPublicEnv, getServerEnv } from "@/lib/env";

/**
 * Server-side Supabase client for Server Components / Server Actions /
 * Route Handlers. Uses the `anon` key + the caller's session cookies, so
 * every query it makes is still subject to RLS (architecture §6) — this is
 * NOT a service-role client.
 *
 * Not called anywhere yet in the Foundation stage; wired up starting with
 * auth (Stage 3).
 */
export async function createSupabaseServerClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
    getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In a Server Component this throws (cookies are read-only there);
          // middleware.ts is what actually refreshes the session cookie.
          // Route Handlers / Server Actions can set cookies, so this is not
          // wrapped in a try/catch that would hide a real bug in those.
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );
}

/**
 * Service-role client — bypasses RLS entirely (architecture §3.4.1). Only
 * ever call this from the narrow, explicitly-justified server-side paths
 * documented there (checkout order creation, payment webhook processing).
 * Never imported by a Client Component; `getServerEnv()` also guards
 * against that at runtime.
 */
export function createSupabaseServiceRoleClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

  return createServerClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // Service-role client is never tied to a user session/cookie.
      },
    },
  });
}
