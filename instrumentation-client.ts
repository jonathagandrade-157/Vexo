import * as Sentry from "@sentry/nextjs";

/**
 * JON-14 — inicialização client-side do Sentry (convenção estável do
 * Next.js 15.3+/16, docs/file-conventions/instrumentation-client). Roda
 * antes da hidratação, sem exportar nenhuma função obrigatória.
 *
 * `sendDefaultPii` fica OFF (padrão do SDK) — nunca cookies/IP completo
 * do visitante por padrão (arquitetura §21: "PII minimizada").
 * `NEXT_PUBLIC_SENTRY_DSN` ausente (ambiente local sem Sentry
 * configurado) faz `Sentry.init` virar no-op, sem quebrar a build nem o
 * app — mesmo princípio de toda integração opcional deste projeto
 * (lib/env.ts: nenhum fluxo essencial pode depender disso).
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1,
  sendDefaultPii: false,
  debug: false,
});
