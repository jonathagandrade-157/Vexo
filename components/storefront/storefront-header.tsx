import Link from "next/link";

/**
 * Adaptado de `vexo_storefront_home_desktop`/`_auditado` (Stitch) — mesmo
 * padrão estrutural (fixo, blur, borda inferior). Ícone de carrinho com
 * contador real (Etapa 9). Busca (Etapa 15 §8) é um `<form method="get">`
 * simples, server-rendered — mesmo princípio já usado em
 * `StorefrontCategoryFilter` (links reais em vez de estado de cliente):
 * nenhum JS novo, o próprio navegador monta a query string.
 */
export function StorefrontHeader({
  storeName,
  storeSlug,
  cartCount,
  searchQuery,
}: {
  storeName: string;
  storeSlug: string;
  cartCount: number;
  searchQuery?: string;
}) {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-outline-variant/30 bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-container-max items-center justify-between gap-4 px-margin-mobile py-4 md:px-margin-desktop">
        <span className="font-display text-headline-sm font-bold tracking-tight text-primary">{storeName}</span>
        <form action={`/loja/${storeSlug}`} className="hidden flex-1 max-w-sm sm:block" method="get">
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
              search
            </span>
            <input
              className="input-focus-glow w-full rounded-lg border border-surface-container-highest bg-surface-container-lowest py-1.5 pl-10 pr-3 font-body text-body-sm text-on-surface placeholder:text-outline-variant focus:outline-none"
              defaultValue={searchQuery}
              name="q"
              placeholder="Buscar produtos…"
              type="search"
            />
          </div>
        </form>
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
