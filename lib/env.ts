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

// Segredos gerais do servidor — exigidos por qualquer fluxo essencial
// (auth, cadastro, trial, onboarding), nunca só por causa de uma
// integração opcional que o tenant pode nem ter configurado ainda.
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Etapa 3: HMAC key for hashing CPF/CNPJ before it ever touches the
  // database (architecture §13) — lib/security/hash-identifier.ts.
  TRIAL_HASH_SECRET: z.string().min(16),
});

// Etapa 11: Mercado Pago OAuth (arquitetura §11) — schema separado do
// `serverSchema` acima de propósito (achado da investigação do ERROR
// 85129527 em produção): `getServerEnv()` validava as duas listas juntas,
// então cadastro/login/onboarding — que nunca tocam em Mercado Pago —
// quebravam em produção sempre que essas credenciais não estavam
// configuradas ainda. Só é lido por código que de fato vai usar a
// integração (lib/payments/registry.ts, o Route Handler de callback OAuth,
// e a Server Action que inicia a conexão) — nunca pelo fluxo de
// auth/cadastro/trial.
const mercadoPagoServerSchema = z.object({
  // Nunca NEXT_PUBLIC_* (client_id só é usado para montar a URL de
  // autorização inteiramente no servidor, antes do redirect).
  MERCADO_PAGO_CLIENT_ID: z.string().min(1),
  MERCADO_PAGO_CLIENT_SECRET: z.string().min(1),
  MERCADO_PAGO_WEBHOOK_SECRET: z.string().min(1),
  // HMAC key para assinar o `state` do OAuth (tenant_id + nonce + expiração) — lib/security/oauth-state.ts.
  OAUTH_STATE_SECRET: z.string().min(16),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;
export type MercadoPagoServerEnv = z.infer<typeof mercadoPagoServerSchema>;

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
let cachedMercadoPagoEnv: MercadoPagoServerEnv | undefined;

/** Variables safe to read from client or server code (`NEXT_PUBLIC_*` only). */
export function getPublicEnv(): PublicEnv {
  cachedPublicEnv ??= readSchema(publicSchema, process.env, "public");
  return cachedPublicEnv;
}

/**
 * Server-only secrets required by the core flows (auth, tenant, trial,
 * onboarding, checkout's own Supabase access). Calling this from a Client
 * Component is a bug by construction: this module is never imported by
 * client code because nothing under `lib/supabase/client.ts` touches it
 * (see that file).
 *
 * Deliberately does NOT include the Mercado Pago variables — see
 * `getMercadoPagoEnv()` below for why they're validated separately.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must never be called from the browser.");
  }
  cachedServerEnv ??= readSchema(serverSchema, process.env, "server");
  return cachedServerEnv;
}

/**
 * Mercado Pago-only secrets — call this ONLY from code that is actually
 * about to use the Mercado Pago integration (gateway instantiation in
 * `lib/payments/registry.ts`, the OAuth connect Server Action, the OAuth
 * callback Route Handler, webhook verification). Never call this from
 * auth/signup/trial/onboarding or any other core flow: those must keep
 * working even when Mercado Pago hasn't been configured for this
 * environment yet (production incident: signup was 500ing because
 * `getServerEnv()` used to validate this list too, so a store with no
 * Mercado Pago credentials set couldn't even open /cadastro).
 *
 * Fails closed with an explicit, safe message (no secret values) telling
 * whoever triggered a real Mercado Pago action that the integration isn't
 * configured — it does not silently disable payment checks or accept a
 * partial/fake configuration.
 */
export function getMercadoPagoEnv(): MercadoPagoServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getMercadoPagoEnv() must never be called from the browser.");
  }
  if (!cachedMercadoPagoEnv) {
    try {
      cachedMercadoPagoEnv = readSchema(mercadoPagoServerSchema, process.env, "Mercado Pago");
    } catch (cause) {
      throw new Error(
        "A integração com o Mercado Pago não está configurada neste ambiente " +
          "(MERCADO_PAGO_CLIENT_ID/MERCADO_PAGO_CLIENT_SECRET/MERCADO_PAGO_WEBHOOK_SECRET/OAUTH_STATE_SECRET). " +
          "Configure essas variáveis antes de conectar ou processar pagamentos.",
        { cause },
      );
    }
  }
  return cachedMercadoPagoEnv;
}
