import Link from "next/link";

import { StorefrontHeroCarousel } from "@/components/storefront/storefront-hero-carousel";
import { StorefrontProductCard } from "@/components/storefront/storefront-product-card";
import type { StorefrontHomeProps } from "@/features/storefront/templates/types";

/**
 * Sprint 1 — Fase B2 — VEXO Editorial. Composição assimétrica (destaque
 * grande + itens menores), tipografia serifada/itálica. O grid
 * assimétrico de categorias é o que diferencia este template — não uma
 * funcionalidade nova, só disposição visual dos mesmos dados.
 *
 * Sprint 1 — Fase C2: o gradiente escuro já existia (decoração fixa,
 * sempre presente) — o carrossel só entra ATRÁS dele quando há banners;
 * sem banners, nada muda (`bg-neutral-900` sólido continua sendo o fundo).
 */
export function EditorialHome({ tenant, categories, products, promotions, banners, activeCategorySlug, searchQuery }: StorefrontHomeProps) {
  const [firstCategory, ...restCategories] = categories;

  return (
    <div className="bg-white text-neutral-900">
      <section className="relative flex min-h-[440px] flex-col items-center justify-center overflow-hidden bg-neutral-900 px-margin-mobile py-24 text-center text-white md:px-margin-desktop">
        {banners.length > 0 ? <StorefrontHeroCarousel banners={banners} /> : null}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="relative z-10 flex max-w-2xl flex-col items-center gap-4">
          <h1 className="font-display text-3xl italic md:text-5xl">{tenant.name}</h1>
          {tenant.description ? <p className="font-body text-body-lg text-white/80">{tenant.description}</p> : null}
          <Link
            className="mt-2 bg-[var(--store-primary)] px-6 py-3 font-label text-label-md uppercase tracking-wide text-white transition-opacity hover:opacity-90"
            href="#produtos"
          >
            Comprar agora
          </Link>
        </div>
      </section>

      <div className="mx-auto flex max-w-container-max flex-col gap-20 px-margin-mobile py-20 md:px-margin-desktop">
        <section id="categorias">
          <h2 className="mb-6 font-display text-xl italic text-neutral-900">Explorar Categorias</h2>
          {categories.length === 0 ? (
            <p className="font-body text-body-sm text-neutral-500">Em breve, categorias por aqui.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Link
                className="flex aspect-[4/3] items-end bg-neutral-100 p-6 transition-opacity hover:opacity-90 md:aspect-auto md:row-span-2"
                href={`?categoria=${firstCategory!.slug}#produtos`}
              >
                <span className="bg-neutral-950/70 px-3 py-1 font-label text-label-md uppercase tracking-wide text-white">
                  {firstCategory!.name}
                </span>
              </Link>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-1">
                {restCategories.slice(0, 2).map((category) => (
                  <Link
                    className="flex aspect-[4/3] items-end bg-neutral-100 p-6 transition-opacity hover:opacity-90"
                    href={`?categoria=${category.slug}#produtos`}
                    key={category.id}
                  >
                    <span className="bg-neutral-950/70 px-3 py-1 font-label text-label-md uppercase tracking-wide text-white">
                      {category.name}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        <section id="produtos">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-display text-xl italic text-neutral-900">
              {activeCategorySlug ? categories.find((c) => c.slug === activeCategorySlug)?.name ?? "Produtos" : "Produtos em Destaque"}
            </h2>
          </div>
          {products.length === 0 ? (
            <p className="font-body text-body-sm text-neutral-500">
              {searchQuery ? `Nenhum produto encontrado para "${searchQuery}".` : "Em breve, novos produtos por aqui."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              {products.map((product) => (
                <StorefrontProductCard key={product.id} product={product} storeSlug={tenant.slug} variant="editorial" />
              ))}
            </div>
          )}
        </section>

        {promotions.length > 0 ? (
          <section className="bg-[var(--store-primary)] px-8 py-12 text-white" id="promocoes">
            <h2 className="mb-2 font-display text-2xl italic">Sale Exclusiva</h2>
            <p className="mb-6 max-w-md font-body text-body-md text-white/90">Peças selecionadas com condição especial por tempo limitado.</p>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              {promotions.map((product) => (
                <StorefrontProductCard key={product.id} product={product} storeSlug={tenant.slug} variant="editorial" />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-xl text-center" id="sobre">
          <h2 className="mb-3 font-display text-xl italic text-neutral-900">Sobre a {tenant.name}</h2>
          <p className="font-body text-body-md text-neutral-600">
            {tenant.description ?? `${tenant.name} é uma loja criada com VEXO.`}
          </p>
        </section>
      </div>
    </div>
  );
}
