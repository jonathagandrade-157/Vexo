/** Suspense boundary automática do Next.js para `/painel/pedidos` e `/painel/pedidos/[id]` — mesmo spinner já usado em product-image-uploader.tsx, não um padrão visual novo. */
export default function PedidosLoading() {
  return (
    <div className="flex items-center justify-center py-24">
      <span className="material-symbols-outlined animate-spin text-3xl text-on-surface-variant">progress_activity</span>
    </div>
  );
}
