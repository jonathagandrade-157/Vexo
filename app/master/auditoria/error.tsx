"use client";

/**
 * Error boundary padrão do Next.js (App Router) para `/master/auditoria` —
 * mesma estrutura de `app/master/lojas/error.tsx`. Uma falha real do
 * Supabase em `listAuditLogsForMaster` lança (nunca vira `[]` silenciosamente
 * — ver comentário no próprio data layer) e cai aqui; nunca expõe
 * `error.message` bruto ao admin (pode conter detalhe interno do
 * Postgres/PostgREST).
 */
export default function MasterAuditoriaError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-error/30 bg-error-container/10 px-6 py-16 text-center">
      <span className="material-symbols-outlined text-3xl text-error">error</span>
      <div className="flex max-w-md flex-col gap-1">
        <h2 className="font-headline text-headline-sm text-on-surface">Não foi possível carregar a auditoria</h2>
        <p className="font-body text-body-md text-on-surface-variant">Tente novamente em instantes.</p>
      </div>
      <button
        className="rounded-lg border border-outline-variant/50 px-5 py-2.5 font-label text-label-md text-on-surface-variant transition-colors hover:border-tertiary/50"
        onClick={reset}
        type="button"
      >
        Tentar novamente
      </button>
    </div>
  );
}
