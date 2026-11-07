import "server-only";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";

import { getServerEnv } from "@/lib/env";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";

/**
 * Limites das operações de Auth feitas pelas Server Actions.
 *
 * Por que na aplicação: as chamadas ao Supabase Auth partem dos servidores
 * da Vercel, então o limite por IP do próprio Supabase enxerga o IP da
 * Vercel (compartilhado por todos os visitantes), não o do atacante. O IP
 * do visitante só existe aqui (`x-forwarded-for` reescrito pela Vercel,
 * lib/security/rate-limit.ts). O contador é o mesmo Postgres compartilhado
 * entre instâncias (public.check_rate_limit), nunca memória do processo.
 *
 * Duas chaves por tentativa: IP (varredura a partir de uma origem) e e-mail
 * (credential stuffing distribuído contra uma conta). O e-mail entra no
 * contador apenas como HMAC com chave de finalidade própria — nenhum
 * endereço em claro em rate_limit_counters.
 *
 * Falha do contador (banco indisponível/erro): login segue (fail-open) —
 * bloquear todo acesso por indisponibilidade do contador derrubaria a
 * operação de todas as lojas, e a senha continua sendo verificada pelo
 * Supabase. Cadastro, reenvio e recuperação falham fechados: geram e-mail
 * e contas, que são justamente o abuso a conter.
 *
 * O acesso direto à API do Supabase Auth com a chave pública não passa por
 * aqui; ali valem os limites por IP do próprio Supabase (IP real do
 * chamador) e, se habilitado, CAPTCHA no provedor — ver relatório.
 */
export type AuthRateLimitedOperation = "sign_in" | "sign_up" | "resend_confirmation" | "password_reset";

interface Rule {
  windowSeconds: number;
  perIp: number;
  perEmail: number;
  failOpen: boolean;
}

export const AUTH_RATE_LIMITS: Record<AuthRateLimitedOperation, Rule> = {
  sign_in: { windowSeconds: 600, perIp: 20, perEmail: 10, failOpen: true },
  sign_up: { windowSeconds: 3600, perIp: 5, perEmail: 3, failOpen: false },
  resend_confirmation: { windowSeconds: 900, perIp: 5, perEmail: 3, failOpen: false },
  password_reset: { windowSeconds: 900, perIp: 5, perEmail: 3, failOpen: false },
};

export const AUTH_RATE_LIMIT_MESSAGE = "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";

function emailKey(email: string): string {
  const key = createHmac("sha256", getServerEnv().TRIAL_HASH_SECRET).update("vexo:auth-rate-limit:v1").digest();
  return createHmac("sha256", key).update(email.trim().toLowerCase()).digest("base64url");
}

/**
 * A suíte de navegador do CI faz dezenas de logins da mesma conta sintética
 * a partir de 127.0.0.1. Só ali o limite é dispensado, com a mesma guarda
 * tripla já usada para mídia em loopback (next.config.ts): CI, marcador do
 * laboratório descartável e URL Supabase exatamente local. Produção,
 * Preview e qualquer host remoto nunca satisfazem as três condições.
 */
export function isDisposableBrowserLab(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env.CI === "true" &&
    env.E2E_ISOLATED_SUPABASE === "1" &&
    ["http://127.0.0.1:54321", "http://localhost:54321"].includes(env.NEXT_PUBLIC_SUPABASE_URL ?? "") &&
    env.VERCEL !== "1"
  );
}

/** `true` quando a tentativa deve ser recusada. */
export async function isAuthAttemptLimited(operation: AuthRateLimitedOperation, email: string): Promise<boolean> {
  const rule = AUTH_RATE_LIMITS[operation];
  if (isDisposableBrowserLab()) return false;
  try {
    const ip = getClientIp(await headers()) ?? "unknown";
    const [byIp, byEmail] = await Promise.all([
      checkRateLimit(`auth:${operation}:ip:${ip}`, rule.windowSeconds, rule.perIp),
      checkRateLimit(`auth:${operation}:email:${emailKey(email)}`, rule.windowSeconds, rule.perEmail),
    ]);
    if (!byIp || !byEmail) {
      console.error("[auth-rate-limit] limiter unavailable", { operation, failOpen: rule.failOpen });
      return !rule.failOpen;
    }
    return !byIp.allowed || !byEmail.allowed;
  } catch (cause) {
    console.error("[auth-rate-limit] limiter failed", {
      operation,
      failOpen: rule.failOpen,
      error: cause instanceof Error ? cause.name : "unknown",
    });
    return !rule.failOpen;
  }
}
