import Image from "next/image";
import Link from "next/link";

import { StorefrontMobileNav } from "@/components/storefront/storefront-mobile-nav";
import type { StorefrontTemplate } from "@/features/settings/appearance-schema";
import { getTenantMediaPublicUrl } from "@/features/settings/logo-storage";

/**
 * Sprint 1 — Fase B2 §4. UM Header compartilhado pelos 5 templates —
 * nunca 5 componentes independentes. `variant` só troca classes
 * (cor/tipografia/alinhamento); logo, nome, navegação, busca, carrinho e
 * responsividade são exatamente os mesmos para qualquer template.
 *
 * Navegação fixa (nunca lida de configuração, nunca outros itens):
 * Início · Produtos · Categorias · Promoções · Sobre — sempre um link
 * absoluto para `/loja/{slug}` + âncora, porque a mesma navegação é usada
 * tanto na Home (rola até a seção) quanto em `/carrinho`/`/checkout`/
 * `/pedido/*` (volta para a Home e rola).
 */
const NAV_ITEMS: { label: string; anchor: string }[] = [
  { label: "Início", anchor: "" },
  { label: "Produtos", anchor: "#produtos" },
  { label: "Categorias", anchor: "#categorias" },
  { label: "Promoções", anchor: "#promocoes" },
  { label: "Sobre", anchor: "#sobre" },
];

interface HeaderVariantStyle {
  wrapper: string;
  bar: string;
  logo: string;
  nav: string;
  navLink: string;
  searchWrap: string;
  searchInput: string;
  icon: string;
}

const VARIANT_STYLES: Record<StorefrontTemplate, HeaderVariantStyle> = {
  commerce: {
    wrapper: "border-b border-neutral-200 bg-white/90 backdrop-blur-md",
    bar: "flex-row items-center justify-between gap-4 py-3",
    logo: "font-display text-lg font-bold tracking-tight text-neutral-900",
    nav: "hidden items-center gap-6 md:flex",
    navLink: "font-label text-label-md text-neutral-600 transition-colors hover:text-[var(--store-primary)]",
    searchWrap: "hidden flex-1 max-w-sm sm:block",
    searchInput:
      "w-full rounded-lg border border-neutral-200 bg-neutral-50 py-1.5 pl-10 pr-3 font-body text-body-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[var(--store-primary)]/30",
    icon: "text-neutral-700",
  },
  premium: {
    wrapper: "border-b border-neutral-200 bg-white",
    bar: "flex-col items-center gap-4 py-5 md:flex-row md:justify-between md:py-6",
    logo: "font-display text-xl font-semibold uppercase tracking-[0.3em] text-neutral-900",
    nav: "hidden items-center gap-8 md:flex",
    navLink:
      "font-label text-label-sm uppercase tracking-widest text-neutral-500 transition-colors hover:text-[var(--store-primary)]",
    searchWrap: "hidden",
    searchInput: "hidden",
    icon: "text-neutral-800",
  },
  minimal: {
    wrapper: "border-b border-neutral-100 bg-white",
    bar: "flex-row items-center justify-between gap-4 py-4",
    logo: "font-display text-base font-medium text-neutral-900",
    nav: "hidden items-center gap-6 md:flex",
    navLink: "font-label text-label-sm uppercase tracking-wide text-neutral-500 transition-colors hover:text-neutral-900",
    searchWrap: "hidden sm:block",
    searchInput:
      "w-40 border-0 border-b border-neutral-200 bg-transparent py-1.5 pl-6 pr-2 font-body text-body-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-900",
    icon: "text-neutral-500",
  },
  editorial: {
    wrapper: "border-b border-neutral-200 bg-white",
    bar: "flex-row items-center justify-between gap-4 py-4",
    logo: "font-display text-lg italic tracking-tight text-neutral-900",
    nav: "hidden items-center gap-6 md:flex",
    navLink: "font-label text-label-md text-neutral-600 transition-colors hover:text-[var(--store-primary)]",
    searchWrap: "hidden flex-1 max-w-xs sm:block",
    searchInput:
      "w-full rounded-none border-0 border-b border-neutral-300 bg-transparent py-1.5 pl-1 pr-3 font-body text-body-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-900",
    icon: "text-neutral-700",
  },
  fashion: {
    wrapper: "border-b border-white/10 bg-neutral-950",
    bar: "flex-row items-center justify-between gap-4 py-3",
    logo: "font-display text-lg font-black uppercase tracking-tight text-[var(--store-primary)]",
    nav: "hidden items-center gap-6 md:flex",
    navLink: "font-label text-label-md uppercase tracking-wide text-white/70 transition-colors hover:text-white",
    searchWrap: "hidden flex-1 max-w-sm sm:block",
    searchInput:
      "w-full rounded-lg border border-white/15 bg-white/5 py-1.5 pl-10 pr-3 font-body text-body-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[var(--store-primary)]/40",
    icon: "text-white",
  },
};

export function StorefrontHeader({
  storeName,
  storeSlug,
  cartCount,
  searchQuery,
  logoUrl,
  variant = "commerce",
}: {
  storeName: string;
  storeSlug: string;
  cartCount: number;
  searchQuery?: string;
  logoUrl?: string | null;
  variant?: StorefrontTemplate;
}) {
  const style = VARIANT_STYLES[variant] ?? VARIANT_STYLES.commerce;
  const homeHref = `/loja/${storeSlug}`;

  return (
    <header className={`fixed top-0 z-50 w-full ${style.wrapper}`}>
      <div className={`mx-auto flex max-w-container-max px-margin-mobile md:px-margin-desktop ${style.bar}`}>
        <Link className={style.logo} href={homeHref}>
          {/* Fallback obrigatório (Sprint 1 Fase B2 §12): sem logo, o nome da loja em texto continua sendo a identidade — nunca um espaço em branco. */}
          {logoUrl ? (
            <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full">
              <Image alt={storeName} className="object-contain" fill sizes="32px" src={getTenantMediaPublicUrl(logoUrl)} />
            </span>
          ) : (
            storeName
          )}
        </Link>

        <nav className={style.nav}>
          {NAV_ITEMS.map((item) => (
            <Link className={style.navLink} href={`${homeHref}${item.anchor}`} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>

        <form action={homeHref} className={style.searchWrap} method="get">
          <div className="relative">
            <span className={`material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] ${style.icon}`}>
              search
            </span>
            <input className={style.searchInput} defaultValue={searchQuery} name="q" placeholder="Buscar produtos…" type="search" />
          </div>
        </form>

        <StorefrontMobileNav
          homeHref={homeHref}
          iconClassName={style.icon}
          navItems={NAV_ITEMS}
          navLinkClassName={style.navLink}
          panelClassName={style.wrapper}
        />

        <Link
          aria-label={`Carrinho${cartCount > 0 ? ` — ${cartCount} ${cartCount === 1 ? "item" : "itens"}` : ""}`}
          className={`relative rounded-full p-2 transition-opacity hover:opacity-70 ${style.icon}`}
          href={`${homeHref}/carrinho`}
        >
          <span className="material-symbols-outlined text-2xl">shopping_cart</span>
          {cartCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--store-primary)] px-1 font-label text-label-sm text-white">
              {cartCount > 99 ? "99+" : cartCount}
            </span>
          ) : null}
        </Link>
      </div>
    </header>
  );
}
