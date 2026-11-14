import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent, scrubSentryTransaction } from "@/lib/sentry/scrub-event";

/**
 * JON-14 — inicialização client-side do Sentry (convenção estável do
 * Next.js 15.3+/16, docs/file-conventions/instrumentation-client). Roda
 * antes da hidratação, sem exportar nenhuma função obrigatória.
 *
 * `dataCollection` preserva explicitamente o baseline restritivo do SDK v10
 * — nunca cookies/IP completo do visitante por padrão (arquitetura §21:
 * "PII minimizada").
 * `NEXT_PUBLIC_SENTRY_DSN` ausente (ambiente local sem Sentry
 * configurado) faz `Sentry.init` virar no-op, sem quebrar a build nem o
 * app — mesmo princípio de toda integração opcional deste projeto
 * (lib/env.ts: nenhum fluxo essencial pode depender disso).
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      response: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
    },
    httpBodies: [],
    urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
  },
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryTransaction,
  debug: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
