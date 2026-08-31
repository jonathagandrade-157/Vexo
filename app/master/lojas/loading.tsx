/** Suspense boundary automática do Next.js para `/master/lojas` (D11.4) — mesmo padrão de `app/painel/pedidos/loading.tsx`/`app/master/auditoria/loading.tsx`. */
export default function LojasLoading() {
  return (
    <div className="flex items-center justify-center py-24">
      <span className="material-symbols-outlined animate-spin text-3xl text-on-surface-variant">progress_activity</span>
    </div>
  );
}
