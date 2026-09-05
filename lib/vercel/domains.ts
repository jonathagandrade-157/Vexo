import "server-only";

import { getVercelEnv } from "@/lib/env";

/**
 * D17.5.1 — wrapper server-side, fino e explícito, sobre a Vercel Domains
 * API (auditoria D17.5.0). Responsabilidade única: traduzir chamadas HTTP
 * à Vercel em resultados internos seguros e previsíveis — nunca decide
 * nada sobre tenant/autorização (isso é responsabilidade exclusiva de
 * `features/settings/domain-vercel-actions.ts`, que chama estas funções
 * só depois de já ter resolvido e validado o tenant).
 *
 * Projeto/team são sempre os valores fixos de `getVercelEnv()`
 * (`VERCEL_PROJECT_ID`/`VERCEL_TEAM_ID`) — nunca resolvidos dinamicamente
 * por nome/busca (D17.5.0 §Fase G do ticket D17.5.1).
 *
 * Nenhuma resposta bruta da API (corpo JSON completo, headers) é
 * devolvida ao chamador — só os campos explicitamente necessários,
 * projetados em `VercelDomainInfo`/`VercelDomainConfigInfo`. O token nunca
 * é exposto por nenhuma função aqui.
 */

const VERCEL_API_BASE = "https://api.vercel.com";
const DEFAULT_TIMEOUT_MS = 10_000;

export type VercelDomainErrorCode =
  | "registered_other_project"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "gone"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "api_error"
  | "invalid_response";

export interface VercelDomainInfo {
  name: string;
  apexName: string;
  projectId: string;
  verified: boolean;
}

export interface VercelDomainConfigInfo {
  misconfigured: boolean;
}

export type VercelDomainResult =
  | { ok: true; domain: VercelDomainInfo }
  | { ok: false; code: VercelDomainErrorCode; retryAfterSeconds?: number };

/**
 * "já registrado no mesmo projeto" é sucesso lógico (ticket Fase G),
 * nunca um `VercelDomainErrorCode` — mas `alreadyRegistered` continua
 * distinguível do registro novo para fins de observabilidade (Fase K
 * lista os dois como eventos de log DIFERENTES).
 */
export type VercelAddDomainResult =
  | { ok: true; domain: VercelDomainInfo; alreadyRegistered: boolean }
  | { ok: false; code: VercelDomainErrorCode; retryAfterSeconds?: number };

export type VercelDomainConfigResult =
  | { ok: true; config: VercelDomainConfigInfo }
  | { ok: false; code: VercelDomainErrorCode; retryAfterSeconds?: number };

export type VercelRemoveDomainResult = { ok: true } | { ok: false; code: VercelDomainErrorCode; retryAfterSeconds?: number };

class VercelTimeoutError extends Error {}
class VercelNetworkError extends Error {}

/** Mesmo padrão de `lib/payments/mercadopago.ts::fetchWithTimeout` (AbortController + timeout fixo) — nunca prende a Server Action se a Vercel ficar lenta/indisponível. Nunca inclui headers/body na mensagem de erro. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new VercelTimeoutError(`vercel: request to ${url} timed out after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    throw new VercelNetworkError(`vercel: network error calling ${url}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildUrl(path: string, teamId: string): string {
  const url = new URL(`${VERCEL_API_BASE}${path}`);
  url.searchParams.set("teamId", teamId);
  return url.toString();
}

function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Nunca lança — todo erro (rede, timeout, HTTP, JSON inesperado) vira um resultado tipado. */
async function vercelFetch(
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown; retryAfterSeconds?: number } | { code: "timeout" | "network_error" }> {
  const { VERCEL_API_TOKEN, VERCEL_TEAM_ID } = getVercelEnv();
  const url = buildUrl(path, VERCEL_TEAM_ID);

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${VERCEL_API_TOKEN}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch (err) {
    if (err instanceof VercelTimeoutError) return { code: "timeout" };
    return { code: "network_error" };
  }

  const retryAfterSeconds = parseRetryAfter(response);
  let body: unknown = null;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return { status: response.status, body, retryAfterSeconds };
}

/** Mapeia status HTTP genérico (não-2xx) para um código interno seguro — usado por todas as operações exceto o `POST` de registro, que precisa de uma regra adicional (ver `addVercelDomain`). */
function mapGenericError(status: number, retryAfterSeconds: number | undefined): { code: VercelDomainErrorCode; retryAfterSeconds?: number } {
  switch (status) {
    case 401:
      return { code: "unauthorized" };
    case 403:
      return { code: "forbidden" };
    case 404:
      return { code: "not_found" };
    case 409:
      return { code: "conflict" };
    case 410:
      return { code: "gone" };
    case 429:
      return { code: "rate_limited", retryAfterSeconds };
    default:
      return { code: "api_error" };
  }
}

function parseDomainInfo(body: unknown): VercelDomainInfo | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || typeof b.apexName !== "string" || typeof b.projectId !== "string" || typeof b.verified !== "boolean") {
    return null;
  }
  return { name: b.name, apexName: b.apexName, projectId: b.projectId, verified: b.verified };
}

/**
 * `POST /v10/projects/{idOrName}/domains` — registra `domain` no projeto
 * fixo do VEXO (`VERCEL_PROJECT_ID`). Nunca busca projeto por nome, nunca
 * usa outro projeto.
 *
 * Disambiguação "já registrado no nosso projeto" vs. "registrado em outro
 * projeto/conta": a API responde `400` para os dois casos, sem um código
 * de erro documentado que os distinga de forma confiável (auditoria
 * D17.5.0 §H) — em vez de adivinhar a partir da mensagem de erro (frágil,
 * não documentado), num `400` esta função consulta
 * `GET /v9/projects/{id}/domains/{domain}` (escopado ao NOSSO projeto):
 *  - domínio aparece no nosso projeto → já registrado por nós → sucesso
 *    lógico (`already_registered`, idempotente — ticket Fase G).
 *  - domínio não aparece (404) no nosso projeto → pertence a outro
 *    projeto/conta → `registered_other_project`, nunca movido
 *    automaticamente (ticket Fase G: "NÃO tentar mover").
 * Esta é uma inferência de comportamento documentado (não confirmada por
 * chamada real nesta etapa) — a Fase M (teste controlado real) deve
 * confirmar empiricamente antes de considerar esta lógica validada em
 * produção.
 */
export async function addVercelDomain(domain: string): Promise<VercelAddDomainResult> {
  const { VERCEL_PROJECT_ID } = getVercelEnv();
  const result = await vercelFetch(`/v10/projects/${VERCEL_PROJECT_ID}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });

  if ("code" in result) return { ok: false, code: result.code };

  if (result.status >= 200 && result.status < 300) {
    const info = parseDomainInfo(result.body);
    if (!info) return { ok: false, code: "invalid_response" };
    return { ok: true, domain: info, alreadyRegistered: false };
  }

  if (result.status === 400) {
    const existing = await getVercelDomain(domain);
    if (existing.ok) return { ok: true, domain: existing.domain, alreadyRegistered: true };
    if (existing.code === "not_found") return { ok: false, code: "registered_other_project" };
    return existing;
  }

  return { ok: false, ...mapGenericError(result.status, result.retryAfterSeconds) };
}

/** `GET /v9/projects/{idOrName}/domains/{domain}` — sempre escopado ao projeto fixo do VEXO; `404` aqui significa "não está neste projeto" (pode não existir, ou pertencer a outro projeto — indistinguível por este endpoint sozinho, ver `addVercelDomain`). */
export async function getVercelDomain(domain: string): Promise<VercelDomainResult> {
  const { VERCEL_PROJECT_ID } = getVercelEnv();
  const result = await vercelFetch(`/v9/projects/${VERCEL_PROJECT_ID}/domains/${encodeURIComponent(domain)}`, { method: "GET" });

  if ("code" in result) return { ok: false, code: result.code };
  if (result.status >= 200 && result.status < 300) {
    const info = parseDomainInfo(result.body);
    if (!info) return { ok: false, code: "invalid_response" };
    return { ok: true, domain: info };
  }
  return { ok: false, ...mapGenericError(result.status, result.retryAfterSeconds) };
}

/** `POST /v9/projects/{idOrName}/domains/{domain}/verify` — reavalia o challenge de verificação da própria Vercel (DNS apontando pra ela). Distinto da nossa verificação de posse por DNS TXT (D17.3), que já aconteceu antes de esta função sequer ser chamada. */
export async function verifyVercelDomain(domain: string): Promise<VercelDomainResult> {
  const { VERCEL_PROJECT_ID } = getVercelEnv();
  const result = await vercelFetch(`/v9/projects/${VERCEL_PROJECT_ID}/domains/${encodeURIComponent(domain)}/verify`, { method: "POST" });

  if ("code" in result) return { ok: false, code: result.code };
  if (result.status >= 200 && result.status < 300) {
    const info = parseDomainInfo(result.body);
    if (!info) return { ok: false, code: "invalid_response" };
    return { ok: true, domain: info };
  }
  return { ok: false, ...mapGenericError(result.status, result.retryAfterSeconds) };
}

/** `GET /v6/domains/{domain}/config` — configuração DNS observada pela Vercel (`misconfigured`). Não escopado a projeto (é sobre o domínio em si), mas ainda exige `teamId`. */
export async function getVercelDomainConfig(domain: string): Promise<VercelDomainConfigResult> {
  const result = await vercelFetch(`/v6/domains/${encodeURIComponent(domain)}/config`, { method: "GET" });

  if ("code" in result) return { ok: false, code: result.code };
  if (result.status >= 200 && result.status < 300) {
    if (!result.body || typeof result.body !== "object" || typeof (result.body as Record<string, unknown>).misconfigured !== "boolean") {
      return { ok: false, code: "invalid_response" };
    }
    return { ok: true, config: { misconfigured: (result.body as Record<string, unknown>).misconfigured as boolean } };
  }
  return { ok: false, ...mapGenericError(result.status, result.retryAfterSeconds) };
}

/**
 * `DELETE /v9/projects/{idOrName}/domains/{domain}` — não chamada por
 * nenhuma Server Action nesta etapa (D17.5.1 não implementa remoção,
 * automática ou manual, por decisão explícita do ticket); existe aqui só
 * para completar o wrapper simetricamente, pronta para uma etapa futura
 * que implementar a remoção pela UI.
 */
export async function removeVercelDomain(domain: string): Promise<VercelRemoveDomainResult> {
  const { VERCEL_PROJECT_ID } = getVercelEnv();
  const result = await vercelFetch(`/v9/projects/${VERCEL_PROJECT_ID}/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });

  if ("code" in result) return { ok: false, code: result.code };
  if (result.status >= 200 && result.status < 300) return { ok: true };
  return { ok: false, ...mapGenericError(result.status, result.retryAfterSeconds) };
}
