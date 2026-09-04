import { resolveTxt } from "node:dns/promises";

import { domainChallengeHashMatches, hashDomainChallenge } from "./domain-challenge";

/**
 * D17.3.2 — consulta DNS TXT real do desafio de verificação de domínio
 * (método aprovado em D17.3.0: exclusivamente `dns_txt`, nunca HTTP —
 * ver `docs/architecture/vexo-arquitetura-tecnica.md` §18.1: uma consulta
 * DNS não estabelece conexão arbitrária para um host escolhido pelo
 * lojista da forma que um `fetch()` faria, então o risco clássico de
 * SSRF não se aplica aqui da mesma forma — mesmo assim, nenhuma
 * interpolação de `domain` em comando de shell, e timeout curto).
 *
 * `node:dns/promises` — nenhuma dependência nova, mesma filosofia já
 * demonstrada no projeto (rate limiting em Postgres em vez de Redis,
 * etc.): usar o que a runtime já oferece antes de adicionar uma lib.
 */

/** `_vexo-challenge.<domain>` — nome fixo do registro esperado (D17.3.0 §D). */
const DNS_CHALLENGE_LABEL = "_vexo-challenge";

/** Curto o bastante para nunca prender a Server Action; `dns.promises.resolveTxt` não aceita AbortSignal, então o timeout é feito com `Promise.race`, mesmo princípio de `fetchWithTimeout` (lib/payments/mercadopago.ts), só sem AbortController porque a API do resolver não suporta. */
const DNS_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Monta o nome do registro TXT esperado a partir do domínio já
 * normalizado (lowercase, sem protocolo/porta — `customDomainSchema`,
 * D17.2, já garante isso antes de o domínio chegar ao banco). Remove um
 * eventual ponto final (forma absoluta de FQDN) antes de montar o nome,
 * para nunca produzir `_vexo-challenge.exemplo.com..` por engano.
 */
export function buildChallengeRecordName(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, "");
  return `${DNS_CHALLENGE_LABEL}.${normalized}`;
}

export type DnsChallengeCheckResult =
  | { outcome: "match" }
  | { outcome: "no_match" }
  | { outcome: "not_found" }
  | { outcome: "error"; reason: "timeout" | "dns_error" };

/** Um mesmo registro TXT pode chegar dividido em múltiplos `<character-string>` de até 255 bytes (RFC 1035 §3.3.14) — o resolver do Node já entrega cada TXT como `string[]` desses segmentos; concatená-los antes de comparar é o único jeito correto de reconstruir o valor publicado. */
function joinTxtSegments(segments: string[]): string {
  return segments.join("");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dns lookup timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Consulta `_vexo-challenge.<domain>` e verifica se ALGUM registro TXT
 * encontrado corresponde ao challenge esperado — nunca assume que existe
 * só um TXT (um domínio pode ter vários, por qualquer motivo do
 * lojista), nunca compara com `===` (usa `domainChallengeHashMatches`,
 * timing-safe). Como o banco só guarda o hash (D17.3.1), a comparação é
 * sempre: hash(valor encontrado) vs. hash armazenado — nunca o token
 * puro é comparado diretamente com o hash.
 *
 * Nunca lança: todo erro de DNS (NXDOMAIN, SERVFAIL, timeout, etc.) vira
 * um resultado categorizado — quem chama decide o que fazer (D17.3.0 §F:
 * nenhum desses casos deve ativar o domínio nem derrubar a aplicação).
 */
export async function checkDomainChallengeTxt(domain: string, expectedTokenHash: string): Promise<DnsChallengeCheckResult> {
  const recordName = buildChallengeRecordName(domain);

  let records: string[][];
  try {
    records = await withTimeout(resolveTxt(recordName), DNS_LOOKUP_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof Error && err.message === "dns lookup timed out") {
      return { outcome: "error", reason: "timeout" };
    }
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { outcome: "not_found" };
    }
    // SERVFAIL, ETIMEOUT do próprio resolver, ECONNREFUSED, resposta
    // malformada, etc. — todos tratados como erro transitório genérico,
    // nunca propagados com o detalhe bruto do resolver.
    return { outcome: "error", reason: "dns_error" };
  }

  for (const segments of records) {
    const value = joinTxtSegments(segments).trim().toLowerCase();
    if (!value) continue;
    if (domainChallengeHashMatches(hashDomainChallenge(value), expectedTokenHash)) {
      return { outcome: "match" };
    }
  }

  return { outcome: "no_match" };
}
