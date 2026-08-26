import Link from "next/link";

import { StorefrontHeroCarousel } from "@/components/storefront/storefront-hero-carousel";
import { StorefrontProductCard } from "@/components/storefront/storefront-product-card";
import type { StorefrontHomeProps } from "@/features/storefront/templates/types";

/**
 * Sprint 1 — Fase B2 — VEXO Premium. Sofisticado, muito whitespace,
 * tipografia com tracking largo, sem grade densa.
 *
 * Sprint 1 — Fase C2: `bg-neutral-950` continua como base (visível antes
 * da imagem carregar e sem nenhum banner cadastrado) — o carrossel só
 * entra como camada extra por cima quando há banners; texto já é branco
 * de origem, então nenhuma cor muda.
 */
export function PremiumHome({ tenant, categories, products, promotions, banners, activeCategorySlug, searchQuery }: StorefrontHomeProps) {
  return (
    <div className="bg-white text-neutral-900">
      <section className="relative flex min-h-[480px] flex-col items-center justify-center overflow-hidden bg-neutral-950 px-margin-mobile py-24 text-center text-white md:px-margin-desktop">
        {banners.length > 0 ? (
          <>
            <StorefrontHeroCarousel banners={banners} />
            <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
          </>
        ) : null}
        <div className="relative z-10 flex max-w-2xl flex-col items-center gap-6">
          <h1 className="font-display text-3xl font-light leading-tight md:text-5xl">{tenant.name}</h1>
          {tenant.description ? <p className="max-w-lg font-body text-body-lg text-white/70">{tenant.description}</p> : null}
          <Link
            className="mt-2 border border-white px-8 py-3 font-label text-label-sm uppercase tracking-widest text-white transition-colors hover:bg-[var(--store-primary)] hover:border-[var(--store-primary)]"
            href="#produtos"
          >
            Descobrir
          </Link>
        </div>
      </section>

      <div className="mx-auto flex max-w-container-max flex-col gap-24 px-margin-mobile py-20 md:px-margin-desktop">
        <section className="text-center" id="categorias">
          <h2 className="mb-10 font-label text-label-sm uppercase tracking-[0.3em] text-neutral-400">Categorias</h2>
          {categories.length === 0 ? (
            <p className="font-body text-body-sm text-neutral-400">Em breve, categorias por aqui.</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {categories.map((category) => (
                <Link
                  className="flex aspect-square items-center justify-center bg-neutral-100 font-label text-label-md uppercase tracking-widest text-neutral-700 transition-colors hover:bg-neutral-200"
                  href={`?categoria=${category.slug}#produtos`}
                  key={category.id}
                >
                  {category.name}
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="text-center" id="produtos">
          <h2 className="mb-10 font-label text-label-sm uppercase tracking-[0.3em] text-neutral-400">
            {activeCategorySlug ? categories.find((c) => c.slug === activeCategorySlug)?.name ?? "Produtos" : "Coleção Exclusiva"}
          </h2>
          {products.length === 0 ? (
            <p className="font-body text-body-sm text-neutral-400">
              {searchQuery ? `Nenhum produto encontrado para "${searchQuery}".` : "Em breve, novos produtos por aqui."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-10 text-left md:grid-cols-4">
              {products.map((product) => (
                <StorefrontProductCard key={product.id} product={product} storeSlug={tenant.slug} variant="premium" />
              ))}
            </div>
          )}
        </section>

        {promotions.length > 0 ? (
          <section className="bg-neutral-50 px-6 py-16 text-center" id="promocoes">
            <p className="mb-2 font-label text-label-sm uppercase tracking-widest text-[var(--store-primary)]">Oferta exclusiva</p>
            <h2 className="mb-8 font-display text-2xl text-neutral-900">Peças selecionadas com condição especial</h2>
            <div className="mx-auto grid max-w-4xl grid-cols-2 gap-x-6 gap-y-10 text-left md:grid-cols-4">
              {promotions.map((product) => (
                <StorefrontProductCard key={product.id} product={product} storeSlug={tenant.slug} variant="premium" />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-xl text-center" id="sobre">
          <p className="mb-2 font-label text-label-sm uppercase tracking-widest text-neutral-400">Nossa história</p>
          <p className="font-body text-body-md leading-relaxed text-neutral-600">
            {tenant.description ?? `${tenant.name} é uma loja criada com VEXO.`}
          </p>
        </section>
      </div>
    </div>
  );
}
