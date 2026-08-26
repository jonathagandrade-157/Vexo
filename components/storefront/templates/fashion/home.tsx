import Link from "next/link";

import { StorefrontHeroCarousel } from "@/components/storefront/storefront-hero-carousel";
import { StorefrontProductCard } from "@/components/storefront/storefront-product-card";
import type { StorefrontHomeProps } from "@/features/storefront/templates/types";

/**
 * Sprint 1 — Fase B2 — VEXO Fashion. Tema escuro, tipografia bold/uppercase,
 * energia streetwear — o único template já visualmente próximo do resto
 * do VEXO (que é dark por padrão), mas com identidade própria via
 * `--store-primary` em vez dos tokens `primary`/`primary-container` do app.
 *
 * Sprint 1 — Fase C2: mesmo princípio do Editorial — o gradiente escuro
 * já existia e continua sempre presente; o carrossel só entra atrás dele
 * quando há banners.
 */
export function FashionHome({ tenant, categories, products, promotions, banners, activeCategorySlug, searchQuery }: StorefrontHomeProps) {
  return (
    <div className="bg-neutral-950 text-white">
      <section className="relative flex min-h-[460px] flex-col items-center justify-center overflow-hidden px-margin-mobile py-24 text-center md:px-margin-desktop">
        {banners.length > 0 ? <StorefrontHeroCarousel banners={banners} /> : null}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-neutral-900" />
        <div className="relative z-10 flex max-w-2xl flex-col items-center gap-4">
          <h1 className="font-display text-4xl font-black uppercase tracking-tight md:text-6xl">{tenant.name}</h1>
          {tenant.description ? <p className="max-w-md font-body text-body-lg text-white/70">{tenant.description}</p> : null}
          <Link
            className="mt-2 flex items-center gap-2 bg-[var(--store-primary)] px-6 py-3 font-label text-label-md uppercase tracking-wide text-white transition-opacity hover:opacity-90"
            href="#produtos"
          >
            Comprar agora
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </Link>
        </div>
      </section>

      <div className="mx-auto flex max-w-container-max flex-col gap-16 px-margin-mobile py-16 md:px-margin-desktop">
        <section id="categorias">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-display text-lg font-black uppercase tracking-tight">Categorias</h2>
          </div>
          {categories.length === 0 ? (
            <p className="font-body text-body-sm text-white/50">Em breve, categorias por aqui.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {categories.map((category) => (
                <Link
                  className="flex aspect-square items-end border border-white/10 bg-neutral-900 p-4 transition-colors hover:border-[var(--store-primary)]/50"
                  href={`?categoria=${category.slug}#produtos`}
                  key={category.id}
                >
                  <span className="bg-black/60 px-2 py-1 font-label text-label-sm uppercase tracking-wide text-white">
                    {category.name}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section id="produtos">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-display text-lg font-black uppercase tracking-tight">
              {activeCategorySlug ? categories.find((c) => c.slug === activeCategorySlug)?.name ?? "Destaques" : "Destaques"}
            </h2>
          </div>
          {products.length === 0 ? (
            <p className="font-body text-body-sm text-white/50">
              {searchQuery ? `Nenhum produto encontrado para "${searchQuery}".` : "Em breve, novos produtos por aqui."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {products.map((product) => (
                <StorefrontProductCard key={product.id} product={product} storeSlug={tenant.slug} variant="fashion" />
              ))}
            </div>
          )}
        </section>

        {promotions.length > 0 ? (
          <section className="border border-white/10 bg-neutral-900 p-8" id="promocoes">
            <p className="mb-1 font-label text-label-sm uppercase tracking-widest text-[var(--store-primary)]">Sale Season</p>
            <h2 className="mb-6 font-display text-2xl font-black uppercase">Ofertas por tempo limitado</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {promotions.map((product) => (
                <StorefrontProductCard key={product.id} product={product} storeSlug={tenant.slug} variant="fashion" />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-xl border-t border-white/10 pt-12 text-center" id="sobre">
          <p className="mb-2 font-label text-label-sm uppercase tracking-widest text-[var(--store-primary)]">A marca</p>
          <h2 className="mb-3 font-display text-lg font-black uppercase tracking-tight">{tenant.name}</h2>
          <p className="font-body text-body-md text-white/70">
            {tenant.description ?? `${tenant.name} é uma loja criada com VEXO.`}
          </p>
        </section>
      </div>
    </div>
  );
}
