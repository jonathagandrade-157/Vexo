import Link from "next/link";

import { StorefrontProductCard } from "@/components/storefront/storefront-product-card";
import type { StorefrontHomeProps } from "@/features/storefront/templates/types";
import { segmentLabel } from "@/features/settings/segments";

/**
 * Sprint 1 — Fase B2 — VEXO Commerce (o modelo recomendado/default).
 * Denso e focado em conversão: hero com CTA, categorias em ícones,
 * produtos e promoções em grade. Sem imagem de fundo no hero (nenhum
 * upload de banner existe ainda — Sprint 21.2) — usa um gradiente com a
 * cor primária da loja, mesmo princípio já usado antes da Fase B2.
 */
export function CommerceHome({ tenant, categories, products, promotions, activeCategorySlug, searchQuery }: StorefrontHomeProps) {
  return (
    <div className="bg-white text-neutral-900">
      <section className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden px-margin-mobile py-24 text-center md:px-margin-desktop">
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-[var(--store-primary)]/15 via-white to-[var(--store-secondary)]/10" />
        <div className="relative z-10 flex max-w-2xl flex-col items-center gap-4">
          {tenant.segment ? (
            <span className="rounded-full border border-[var(--store-primary)]/30 bg-[var(--store-primary)]/10 px-3 py-1 font-label text-label-sm uppercase tracking-wider text-[var(--store-primary)]">
              {segmentLabel(tenant.segment)}
            </span>
          ) : null}
          <h1 className="font-display text-display-lg-mobile text-neutral-900 md:text-display-lg">{tenant.name}</h1>
          {tenant.description ? <p className="font-body text-body-lg text-neutral-600">{tenant.description}</p> : null}
          <Link
            className="mt-2 rounded-lg bg-[var(--store-primary)] px-6 py-3 font-label text-label-md text-white transition-opacity hover:opacity-90"
            href="#produtos"
          >
            Ver produtos
          </Link>
        </div>
      </section>

      <div className="mx-auto flex max-w-container-max flex-col gap-16 px-margin-mobile pb-20 md:px-margin-desktop">
        <section id="categorias">
          <h2 className="mb-6 text-center font-headline text-headline-sm text-neutral-900">Compre por Categoria</h2>
          {categories.length === 0 ? (
            <p className="text-center font-body text-body-sm text-neutral-500">Em breve, categorias por aqui.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {categories.map((category) => (
                <Link
                  className="flex flex-col items-center gap-3 rounded-xl border border-neutral-200 p-4 text-center transition-colors hover:border-[var(--store-primary)]/40"
                  href={`?categoria=${category.slug}#produtos`}
                  key={category.id}
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100">
                    <span className="material-symbols-outlined text-2xl text-neutral-500">category</span>
                  </span>
                  <span className="font-label text-label-md text-neutral-800">{category.name}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section id="produtos">
          <h2 className="mb-6 text-center font-headline text-headline-sm text-neutral-900">
            {activeCategorySlug ? categories.find((c) => c.slug === activeCategorySlug)?.name ?? "Produtos" : "Destaques da Coleção"}
          </h2>
          {products.length === 0 ? (
            <p className="text-center font-body text-body-sm text-neutral-500">
              {searchQuery ? `Nenhum produto encontrado para "${searchQuery}".` : "Em breve, novos produtos por aqui."}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => (
                <StorefrontProductCard key={product.id} product={product} storeSlug={tenant.slug} variant="commerce" />
              ))}
            </div>
          )}
        </section>

        {promotions.length > 0 ? (
          <section id="promocoes">
            <h2 className="mb-6 text-center font-headline text-headline-sm text-neutral-900">Ofertas Imperdíveis</h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {promotions.map((product) => (
                <StorefrontProductCard key={product.id} product={product} storeSlug={tenant.slug} variant="commerce" />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-2xl text-center" id="sobre">
          <h2 className="mb-3 font-headline text-headline-sm text-neutral-900">Sobre a {tenant.name}</h2>
          <p className="font-body text-body-md text-neutral-600">
            {tenant.description ?? `${tenant.name} é uma loja criada com VEXO.`}
          </p>
        </section>
      </div>
    </div>
  );
}
