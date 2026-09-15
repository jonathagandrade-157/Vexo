import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry/scrub-event";

/**
 * JON-14 — inicialização do runtime Edge (Middleware/proxy.ts, rotas
 * marcadas `runtime: "edge"`) do Sentry, carregada por instrumentation.ts
 * quando NEXT_RUNTIME === "edge". Mesmo `beforeSend` de
 * sentry.server.config.ts (arquitetura §11.1) — nenhum runtime fica sem
 * a mesma defesa em profundidade.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1,
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,
  debug: false,
});
