"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Uses only the publishable key (public, safe to ship —
 * architecture §3.4/§23) and is subject to RLS on every request, same as
 * the server client. Never import `getServerEnv`/`SUPABASE_SERVICE_ROLE_KEY`
 * from a file reachable from here.
 *
 * JON-30 — lê `NEXT_PUBLIC_*` por acesso LITERAL (`process.env.NEXT_PUBLIC_X`
 * escrito direto aqui), nunca via `getPublicEnv()`/`lib/env.ts`: o Next.js só
 * inlina `NEXT_PUBLIC_*` no bundle do client quando o acesso é uma expressão
 * literal reconhecível em build time — `getPublicEnv()` passa `process.env`
 * inteiro para o Zod validar dinamicamente, o que nunca é inlinado, e no
 * browser (onde `process.env` não existe de verdade) as duas variáveis
 * vinham sempre `undefined` (Sentry VEXO-2, "Invalid public environment
 * variables" — o preview de logo em /painel/aparencia quebrava, mas o mesmo
 * bug afetava qualquer Client Component que chamasse este arquivo).
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Both accesses must remain literal so Next.js can inline them. Prefer
  // the modern opaque key; keep the legacy key only during migration.
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL ausente");
  if (!publishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ausente");
  }

  return createBrowserClient(url, publishableKey);
}
