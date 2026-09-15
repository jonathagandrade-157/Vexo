import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry/scrub-event";

/**
 * JON-14 — inicialização server-side (runtime Node.js) do Sentry,
 * carregada por instrumentation.ts quando NEXT_RUNTIME === "nodejs".
 * `beforeSend` (scrubSentryEvent) é a exigência de arquitetura §11.1: uma
 * credencial de gateway de pagamento nunca pode chegar ao Sentry, em
 * nenhuma circunstância — ver lib/sentry/scrub-event.ts.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1,
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,
  debug: false,
});
