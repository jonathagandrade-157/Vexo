/** Suspense boundary automática do Next.js para `/painel/historico` — mesmo padrão de `app/master/auditoria/loading.tsx`, não um spinner novo. */
export default function HistoricoLoading() {
  return (
    <div className="flex items-center justify-center py-24">
      <span className="material-symbols-outlined animate-spin text-3xl text-on-surface-variant">progress_activity</span>
    </div>
  );
}
