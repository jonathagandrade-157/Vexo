/**
 * Adaptado de `vexo_storefront_home_desktop`/`_auditado` (Stitch) — mesmo
 * padrão estrutural (fixo, blur, borda inferior), mas sem busca, sem
 * conta, sem carrinho/wishlist com contador: nenhuma dessas
 * funcionalidades existe ainda (produtos, clientes, carrinho são de
 * etapas futuras) e um contador fixo/uma busca sem resultado nenhum
 * seria dado fictício. Só a identidade da loja.
 */
export function StorefrontHeader({ storeName }: { storeName: string }) {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-outline-variant/30 bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-container-max items-center px-margin-mobile py-4 md:px-margin-desktop">
        <span className="font-display text-headline-sm font-bold tracking-tight text-primary">
          {storeName}
        </span>
      </div>
    </header>
  );
}
