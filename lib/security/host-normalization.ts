/**
 * D17.4.1 — normalização pura do `Host` HTTP recebido numa requisição, para
 * uso futuro pelo Host Routing (D17.4.2, ainda não implementado — este
 * arquivo não é chamado por `proxy.ts` nem por nenhuma rota nesta etapa).
 *
 * Sem I/O, sem DNS, sem banco, sem `fetch`, nunca lança para input externo
 * inválido (mesmo princípio de `checkDomainChallengeTxt`,
 * `lib/security/dns-verification.ts`: todo erro vira um resultado
 * categorizado — aqui, `null`). Só produz um hostname no mesmo formato
 * validado por `customDomainSchema` (`features/settings/domain-schema.ts`)
 * antes de gravar em `tenant_domains.domain` — nunca um valor "quase certo"
 * que a consulta a `tenant_domains` teria que normalizar de novo.
 *
 * Não usa `x-forwarded-host` (não é responsabilidade desta função: ela só
 * normaliza uma string já escolhida pelo chamador — qual header confiar é
 * decisão do futuro `proxy.ts`, D17.4.2).
 */

const MAX_HOSTNAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Um único rótulo válido de hostname (RFC 1123): alfanumérico, hífen permitido no meio, nunca no início/fim. */
const LABEL_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Último rótulo (TLD): só letras, mínimo 2 — mesmo formato já exigido por `HOSTNAME_REGEX` em `customDomainSchema`, para nunca aceitar aqui um valor que aquele schema teria rejeitado no cadastro. */
const TLD_LABEL_REGEX = /^[a-z]{2,}$/;

const IPV4_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Caracteres/sequências que nunca pertencem a um `Host` puro — presença de
 * qualquer um já rejeita o valor inteiro sem tentar interpretá-lo mais.
 * Cobre esquema de URL (`://`), credenciais (`@`), path/query/fragment
 * (`/`, `?`, `#`) e múltiplos hosts separados por vírgula.
 */
function containsDisallowedSequence(value: string): boolean {
  return (
    /\s/.test(value) ||
    value.includes("://") ||
    value.includes("@") ||
    value.includes("/") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes(",")
  );
}

/**
 * Separa host e porta de `value` (já minúsculo, já sem os caracteres
 * proibidos). Só aceita **um único** `:` — dois ou mais é sempre rejeitado
 * aqui (nunca tratado como "host:porta:algo" nem interpretado como
 * heurística de IPv6: a aceitação real de qualquer valor, IPv6 incluído,
 * depende inteiramente da validação de rótulos abaixo, que nunca aceita
 * `:` dentro de um rótulo — este split é só conveniência de parsing, não a
 * fronteira de segurança).
 */
function splitHostPort(value: string): { hostname: string; port: string | null } | null {
  const colonCount = (value.match(/:/g) ?? []).length;
  if (colonCount === 0) return { hostname: value, port: null };
  if (colonCount > 1) return null;

  const colonIndex = value.indexOf(":");
  const hostname = value.slice(0, colonIndex);
  const port = value.slice(colonIndex + 1);
  return { hostname, port };
}

/** Aceita um trailing dot único ou múltiplo (`example.com.`/`example.com..`) — forma absoluta de FQDN, mesmo tratamento de `buildChallengeRecordName` (`lib/security/dns-verification.ts`). */
function stripTrailingDots(value: string): string {
  return value.replace(/\.+$/, "");
}

/** Porta válida: só dígitos (após remover trailing dot(s) — `"443."` é uma porta 443 seguida de um ponto final do host completo), no intervalo de porta TCP válido. */
function isValidPort(rawPort: string): boolean {
  const digitsOnly = stripTrailingDots(rawPort);
  if (!/^\d+$/.test(digitsOnly)) return false;
  const port = Number(digitsOnly);
  return port >= MIN_PORT && port <= MAX_PORT;
}

function isValidHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > MAX_HOSTNAME_LENGTH) return false;
  if (hostname === "localhost") return false;
  if (IPV4_REGEX.test(hostname)) return false;

  const labels = hostname.split(".");
  // Exige pelo menos 2 rótulos (nome + TLD) — mesmo mínimo de
  // `customDomainSchema`; um hostname de um rótulo só nunca corresponde a
  // um valor que `tenant_domains.domain` poderia conter.
  if (labels.length < 2) return false;

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) return false;
    if (!LABEL_REGEX.test(label)) return false;
  }

  const tld = labels[labels.length - 1]!;
  return TLD_LABEL_REGEX.test(tld);
}

/**
 * Normaliza um `Host` bruto para o mesmo formato gravado em
 * `tenant_domains.domain` (lowercase, sem porta, sem trailing dot), ou
 * `null` se o valor não for um hostname válido — nunca lança.
 *
 * IPv4, IPv6 e `localhost` sempre retornam `null`: nenhum deles pode
 * aparecer em `tenant_domains.domain` (só passa por lá o que
 * `customDomainSchema` já validou no cadastro), então nunca são elegíveis
 * para resolução de domínio de tenant.
 */
export function normalizeHost(rawHost: string | null): string | null {
  if (rawHost === null) return null;

  const trimmed = rawHost.trim();
  if (trimmed === "") return null;
  if (containsDisallowedSequence(trimmed)) return null;

  const lower = trimmed.toLowerCase();

  // IPv6 literal entre colchetes (com ou sem porta, ex.: "[::1]",
  // "[::1]:8080") — rejeitado explicitamente antes de qualquer split por
  // ":", já que colchetes nunca pertencem a um hostname puro.
  if (lower.startsWith("[") || lower.includes("]")) return null;

  const split = splitHostPort(lower);
  if (!split) return null;

  if (split.port !== null && !isValidPort(split.port)) return null;

  const hostname = stripTrailingDots(split.hostname);
  if (!isValidHostname(hostname)) return null;

  return hostname;
}
