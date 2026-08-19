"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";

/**
 * Browser Supabase client. Uses only the `anon` key (public, safe to ship —
 * architecture §3.4/§23) and is subject to RLS on every request, same as
 * the server client. Never import `getServerEnv`/`SUPABASE_SERVICE_ROLE_KEY`
 * from a file reachable from here.
 *
 * Not called anywhere yet in the Foundation stage.
 */
export function createSupabaseBrowserClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
    getPublicEnv();

  return createBrowserClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
