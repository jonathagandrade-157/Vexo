/**
 * JON-14 — rota TEMPORÁRIA só para validar a integração do Sentry
 * (instrumentation.ts → onRequestError → Sentry). Acesse
 * /api/sentry-test em produção/preview depois do deploy e confirme que o
 * evento aparece no projeto "javascript-nextjs" do Sentry.
 *
 * REMOVER ESTE ARQUIVO (e a pasta app/api/sentry-test/) depois da
 * validação — nunca deixar uma rota que sempre lança 500 de propósito em
 * produção.
 */
export async function GET() {
  throw new Error("JON-14 — erro de teste proposital para validar o Sentry. Remova esta rota após confirmar o evento.");
}
