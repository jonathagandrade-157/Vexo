import Link from "next/link";

/**
 * Adaptado de `vexo_storefront_home_desktop`/`_auditado` (Stitch) — mesmo
 * padrão estrutural (fixo, blur, borda inferior). Ícone de carrinho com
 * contador real (Etapa 9) — sem busca/conta ainda (fora do escopo desta
 * etapa).
 */
export function StorefrontHeader({
  storeName,
  storeSlug,
  cartCount,
}: {
  storeName: string;
  storeSlug: string;
  cartCount: number;
}) {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-outline-variant/30 bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-container-max items-center justify-between px-margin-mobile py-4 md:px-margin-desktop">
        <span className="font-display text-headline-sm font-bold tracking-tight text-primary">{storeName}</span>
        <Link
          aria-label={`Carrinho${cartCount > 0 ? ` — ${cartCount} ${cartCount === 1 ? "item" : "itens"}` : ""}`}
          className="relative rounded-full p-2 text-on-surface transition-colors hover:text-primary"
          href={`/loja/${storeSlug}/carrinho`}
        >
          <span className="material-symbols-outlined text-2xl">shopping_cart</span>
          {cartCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 font-label text-label-sm text-on-primary">
              {cartCount > 99 ? "99+" : cartCount}
            </span>
          ) : null}
        </Link>
      </div>
    </header>
  );
}
