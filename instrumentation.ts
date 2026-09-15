import * as Sentry from "@sentry/nextjs";

/**
 * JON-14 — ponto único de bootstrap do Sentry no servidor (convenção
 * estável do Next.js, docs/file-conventions/instrumentation). `register`
 * carrega o config certo por runtime; `onRequestError` é o hook nativo do
 * Next.js para erros de servidor (Server Components/Route Handlers/
 * Server Actions), repassado direto para o Sentry.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
