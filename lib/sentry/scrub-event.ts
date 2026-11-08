import type { ErrorEvent, EventHint, NodeOptions } from "@sentry/nextjs";

export type TransactionEvent = Parameters<NonNullable<NodeOptions["beforeSendTransaction"]>>[0];

/**
 * JON-14 — arquitetura §11.1/§21: uma credencial de gateway de pagamento
 * (vault), cookie de sessão, token, CPF/CNPJ ou dado de cartão nunca pode
 * chegar ao Sentry, em nenhuma circunstância. `sendDefaultPii` já fica
 * desligado (padrão do SDK) em sentry.server.config.ts/
 * sentry.edge.config.ts — este `beforeSend` é defesa em profundidade em
 * DUAS camadas (nunca a única: o código que chama gateways já nunca loga
 * body bruto, arquitetura §11.1):
 *
 *  1. Por NOME de campo (`scrub`) em objetos estruturados
 *     (request/extra/contexts/breadcrumb.data) — um valor sensível que
 *     acabe ali por engano nunca sai como está, seja lá qual for o tipo.
 *  2. Por CONTEÚDO (`scrubString`) em texto livre (message/exception
 *     value/breadcrumb message) — onde não existe um "nome de campo" para
 *     ancorar a checagem, só a palavra-chave dentro da própria frase
 *     (ex.: "token=abc123 inválido", "Authorization: Bearer eyJ...").
 *     Redige a PARTIR da palavra-chave até o próximo delimitador
 *     estrutural (`,`/`;`/`)`/`}`/`]`/quebra de linha) ou fim da string —
 *     deliberadamente mais abrangente que "só o próximo token sem
 *     espaço" (um valor como "Bearer eyJ..." ou um número de cartão com
 *     espaços nunca escaparia por causa de um espaço no meio do valor).
 */
const SENSITIVE_KEYWORDS =
  "token|secret|password|senha|authorization|cookie|api[_-]?key|client_secret|cpf|cnpj|pix|cartao|card|cvv|cvc";

const SENSITIVE_KEY_PATTERN = new RegExp(SENSITIVE_KEYWORDS, "i");

// Grupo 1: a palavra-chave em si (preservada no resultado, só o valor é
// redigido). Grupo 2: o separador (":"/"="/espaço, com espaços em volta
// opcionais). Grupo 3: o valor, tudo até o próximo delimitador estrutural
// (nunca cruza para o "próximo campo" de um blob tipo texto).
const SENSITIVE_VALUE_PATTERN = new RegExp(`(${SENSITIVE_KEYWORDS})(\\s*[:=]\\s*|\\s+)([^,;)}\\]\n]+)`, "gi");

const REDACTED = "[Filtered]";

// Prova de posse da confirmação de pedido (`?acesso=`, lib/security/
// order-access-token.ts). Aparece dentro de URLs — request.url,
// query_string, breadcrumbs de navegação/fetch, spans — onde não existe
// nome de campo sensível para ancorar a redação.
const URL_SECRET_PARAM_PATTERN = /(^|[?&;])((?:acesso|token|code|state)=)[^&#\s"'<>]+/gi;

function redactUrlSecrets(text: string): string {
  return text.replace(URL_SECRET_PARAM_PATTERN, `$1$2${REDACTED}`);
}

function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactUrlSecrets(value);
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : scrub(val, depth + 1);
  }
  return result;
}

/** Redige por CONTEÚDO dentro de uma string solta (sem nome de campo para ancorar) — ver cabeçalho do arquivo. */
function scrubString(text: string): string {
  return redactUrlSecrets(text).replace(SENSITIVE_VALUE_PATTERN, (_match, keyword: string, separator: string) => `${keyword}${separator}${REDACTED}`);
}

export function scrubSentryEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  if (event.request) event.request = scrub(event.request) as typeof event.request;
  if (event.extra) event.extra = scrub(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;

  if (event.message) event.message = scrubString(event.message);

  if (event.exception?.values) {
    for (const exceptionValue of event.exception.values) {
      if (exceptionValue.value) exceptionValue.value = scrubString(exceptionValue.value);
    }
  }

  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (breadcrumb.message) breadcrumb.message = scrubString(breadcrumb.message);
      if (breadcrumb.data) breadcrumb.data = scrub(breadcrumb.data) as typeof breadcrumb.data;
    }
  }

  return event;
}

/**
 * Eventos de transação/performance não passam por `beforeSend`: sem isto,
 * URLs com `?acesso=` chegariam ao Sentry pelos spans e pelo request da
 * transação amostrada.
 */
export function scrubSentryTransaction(event: TransactionEvent, _hint: EventHint): TransactionEvent {
  if (event.request) event.request = scrub(event.request) as typeof event.request;
  if (event.extra) event.extra = scrub(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
  if (event.transaction) event.transaction = redactUrlSecrets(event.transaction);
  if (event.spans) {
    for (const span of event.spans) {
      if (span.description) span.description = redactUrlSecrets(span.description);
      if (span.data) span.data = scrub(span.data) as typeof span.data;
    }
  }
  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (breadcrumb.message) breadcrumb.message = scrubString(breadcrumb.message);
      if (breadcrumb.data) breadcrumb.data = scrub(breadcrumb.data) as typeof breadcrumb.data;
    }
  }
  return event;
}
