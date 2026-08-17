import { z } from "zod";

/**
 * Typed, validated access to environment variables (architecture §23).
 *
 * Only variables actually wired up in the current stage are declared here.
 * Each later stage adds its own variables to the relevant schema below
 * instead of pre-declaring secrets for features that don't exist yet.
 *
 * Parsing is lazy (first access, memoized) so importing this module never
 * throws at build time or in a context where env vars are legitimately
 * absent (e.g. `next lint`) — it only throws when a value is actually read.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function readSchema<T>(
  schema: z.ZodType<T>,
  source: Record<string, string | undefined>,
  label: string,
): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid ${label} environment variables:\n${issues}\n\n` +
        "Check .env.local against .env.example.",
    );
  }
  return result.data;
}

let cachedPublicEnv: PublicEnv | undefined;
let cachedServerEnv: ServerEnv | undefined;

/** Variables safe to read from client or server code (`NEXT_PUBLIC_*` only). */
export function getPublicEnv(): PublicEnv {
  cachedPublicEnv ??= readSchema(publicSchema, process.env, "public");
  return cachedPublicEnv;
}

/**
 * Server-only secrets. Calling this from a Client Component is a bug by
 * construction: this module is never imported by client code because
 * nothing under `lib/supabase/client.ts` touches it (see that file).
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must never be called from the browser.");
  }
  cachedServerEnv ??= readSchema(serverSchema, process.env, "server");
  return cachedServerEnv;
}
