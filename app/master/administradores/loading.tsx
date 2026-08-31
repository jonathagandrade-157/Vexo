/** Suspense boundary automática do Next.js para `/master/administradores` — mesmo padrão de `app/painel/pedidos/loading.tsx`. */
export default function AdministradoresLoading() {
  return (
    <div className="flex items-center justify-center py-24">
      <span className="material-symbols-outlined animate-spin text-3xl text-on-surface-variant">progress_activity</span>
    </div>
  );
}
