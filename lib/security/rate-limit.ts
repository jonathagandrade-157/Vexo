import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * D15-S.2 — rate limiting compartilhado entre instâncias serverless via
 * Postgres (`public.check_rate_limit`, migration
 * 20260817220099_rate_limit_counters.sql) — nunca em memória do processo
 * (ver o comentário dessa migration para o porquê: nenhuma variável de
 * módulo/Map/Set sobrevive a múltiplas instâncias, cold start ou
 * distribuição geográfica no Vercel).
 */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * `null` = o limiter está indisponível (erro ao falar com o banco) — cada
 * chamador decide fail-open vs. fail-closed para o próprio endpoint (ver
 * app/api/shipping/quote/route.ts vs. app/api/address/cep/route.ts);
 * esta função nunca decide isso sozinha.
 */
export async function checkRateLimit(key: string, windowSeconds: number, maxRequests: number): Promise<RateLimitResult | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  });

  if (error || !data || data.length === 0) {
    return null;
  }

  const row = data[0] as { allowed: boolean; current_count: number; retry_after_seconds: number };
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}

/**
 * IP do cliente a partir de headers confiáveis do Vercel — nunca de um
 * campo de formulário/query/body (não é dado do cliente, é o que o edge
 * da Vercel já resolveu e anexou à requisição antes dela chegar aqui).
 * `x-forwarded-for` pode ter uma cadeia "cliente, proxy1, proxy2" — o
 * primeiro valor é sempre o mais próximo do cliente real nesse ambiente.
 * `null` só quando nenhum dos dois headers está presente (nunca deveria
 * acontecer atrás do proxy da Vercel em produção, mas local/dev não tem
 * esse proxy) — cada chamador decide o que fazer nesse caso.
 */
export function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

  return null;
}

/** Resposta 429 padronizada — nunca revela a chave/tenant/IP usados internamente, só o suficiente para o cliente saber quando tentar de novo. */
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { status: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } },
  );
}
