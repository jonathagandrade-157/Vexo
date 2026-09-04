import { createHash, randomBytes } from "node:crypto";

import { identifierHashesMatch } from "./hash-identifier";

/**
 * D17.3.1 — fundação do desafio de verificação de domínio (DNS TXT,
 * decisão já aprovada em D17.3.0). Nenhuma função aqui toca banco/rede —
 * puramente computacional, mesmo estilo de `oauth-state.ts`/
 * `hash-identifier.ts`. A consulta DNS real (D17.3.2) e a Server Action
 * que grava o resultado (também D17.3.2) NÃO existem ainda.
 *
 * Por que SHA-256 simples (sem HMAC/segredo), diferente de
 * `hashIdentifier()`: o challenge já nasce com 128 bits de entropia
 * própria (`crypto.randomBytes(16)`), então um hash simples já é seguro
 * contra força bruta — um segredo/pepper só é necessário quando o valor
 * de entrada tem baixa entropia (como CPF/CNPJ, o caso de
 * `hashIdentifier`), nunca para um valor já aleatório. Adicionar HMAC
 * aqui seria complexidade sem ganho real de segurança.
 */

/** 128 bits — mínimo aprovado em D17.3.0. */
const CHALLENGE_ENTROPY_BYTES = 16;

/** dns_txt é o único método aprovado (D17.3.0) — mesmo valor aceito pela constraint `tenant_domains_verification_method_valid` (migration 20260817220101). */
export const DOMAIN_VERIFICATION_METHOD = "dns_txt" as const;

export const DOMAIN_CHALLENGE_TTL_MS = 72 * 60 * 60 * 1000; // 72 horas (D17.3.0 §E)

/**
 * Gera um challenge aleatório com 128 bits de entropia, representado em
 * hex (64 hex chars representariam 256 bits; aqui são 32 hex chars para
 * os 128 bits de `CHALLENGE_ENTROPY_BYTES`) — hex escolhido por ser a
 * mesma representação já usada no projeto para valores derivados de hash
 * (`hashIdentifier()` também usa `.digest("hex")`), e por ser um formato
 * seguro para publicar num registro DNS TXT (só `[0-9a-f]`, sem
 * ambiguidade de maiúsculas/minúsculas nem caracteres especiais).
 *
 * Nunca derivado de `tenant_id`/`domain` — um valor derivado seria
 * recalculável por qualquer um que soubesse o algoritmo (o `tenant_id`
 * não é secreto), o que reduziria a prova de posse a "saber o tenant_id".
 */
export function generateDomainChallenge(): string {
  return randomBytes(CHALLENGE_ENTROPY_BYTES).toString("hex");
}

/**
 * SHA-256 (hex) do challenge — o único formato que deve ser persistido
 * (nunca o valor de `generateDomainChallenge()` em texto puro). Sem
 * segredo de propósito — ver comentário do topo do arquivo.
 */
export function hashDomainChallenge(challenge: string): string {
  return createHash("sha256").update(challenge).digest("hex");
}

/**
 * Comparação em tempo constante entre dois hashes hex — nunca `===`
 * (comparação de string comum vaza timing proporcional ao primeiro byte
 * divergente). Reaproveita `identifierHashesMatch()` (já timing-safe,
 * já usado para hash em hex neste projeto) em vez de duplicar a mesma
 * lógica de `timingSafeEqual` — o nome aqui só existe para deixar claro,
 * no ponto de chamada futuro (D17.3.2), que a comparação é de um
 * challenge de domínio, não de um documento de identidade.
 */
export function domainChallengeHashMatches(hash: string, expectedHash: string): boolean {
  return identifierHashesMatch(hash, expectedHash);
}

/** `verification_started_at` + 72h. Sempre a partir de um `Date` já resolvido pelo chamador — nunca calcula a própria hora aqui, para deixar explícito que é responsabilidade do chamador usar hora do servidor (nunca do cliente). */
export function computeDomainChallengeExpiry(startedAt: Date): Date {
  return new Date(startedAt.getTime() + DOMAIN_CHALLENGE_TTL_MS);
}

/**
 * `now` default para `new Date()` — sempre resolvido no runtime do
 * servidor no instante da chamada (Server Action/Route Handler futuros),
 * nunca um valor que um chamador deveria aceitar de input do cliente.
 * Nenhum chamador futuro deve passar um `now` vindo de `formData`/body
 * da requisição.
 */
export function isDomainChallengeExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() > expiresAt.getTime();
}

/** Os 4 campos que uma rotação de challenge (D17.3.2) deve escrever juntos, numa única operação atômica — nunca em passos separados, para nunca deixar `tenant_domains` com uma combinação inconsistente (ex.: hash novo com expiração antiga). */
export interface DomainChallengeRecord {
  verificationMethod: typeof DOMAIN_VERIFICATION_METHOD;
  verificationTokenHash: string;
  verificationStartedAt: Date;
  verificationExpiresAt: Date;
}

/**
 * Gera um novo challenge completo — o token em texto puro (só para
 * exibir ao lojista uma única vez, nunca persistido) e o registro pronto
 * para gravação atômica (D17.3.2: um único `UPDATE ... SET
 * verification_method = ..., verification_token_hash = ...,
 * verification_started_at = ..., verification_expires_at = ...`, nunca
 * campo a campo). Um novo challenge sempre substitui — nunca coexiste
 * com — qualquer challenge anterior daquele domínio (D17.3.0 §E, rotação).
 */
export function createDomainChallenge(now: Date = new Date()): { token: string; record: DomainChallengeRecord } {
  const token = generateDomainChallenge();
  return {
    token,
    record: {
      verificationMethod: DOMAIN_VERIFICATION_METHOD,
      verificationTokenHash: hashDomainChallenge(token),
      verificationStartedAt: now,
      verificationExpiresAt: computeDomainChallengeExpiry(now),
    },
  };
}
