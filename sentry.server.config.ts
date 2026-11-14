import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent, scrubSentryTransaction } from "@/lib/sentry/scrub-event";

/**
 * JON-14 — inicialização server-side (runtime Node.js) do Sentry,
 * carregada por instrumentation.ts quando NEXT_RUNTIME === "nodejs".
 * `beforeSend` (scrubSentryEvent) é a exigência de arquitetura §11.1: uma
 * credencial de gateway de pagamento nunca pode chegar ao Sentry, em
 * nenhuma circunstância — ver lib/sentry/scrub-event.ts.
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
