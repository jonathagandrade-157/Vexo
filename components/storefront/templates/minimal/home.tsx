import Link from "next/link";

import { StorefrontProductCard } from "@/components/storefront/storefront-product-card";
import type { StorefrontHomeProps } from "@/features/storefront/templates/types";

/**
 * Sprint 1 — Fase B2 — VEXO Minimal. O único dos 5 SEM Hero de imagem —
 * é a identidade do template (limpo, direto, catálogo pequeno), não uma
 * omissão: um bloco de texto centralizado substitui o hero. Categorias
 * viram abas de filtro (texto), não cards — reduz ornamentação ao máximo.
 */
export function MinimalHome({ tenant, categories, products, promotions, activeCategorySlug, searchQuery }: StorefrontHomeProps) {
  return (
    <div className="bg-white text-neutral-900">
      <section className="flex flex-col items-center gap-3 px-margin-mobile py-16 text-center md:px-margin-desktop">
        <h1 className="font-display text-2xl font-medium text-neutral-900">{tenant.name}</h1>
        {tenant.description ? <p className="font-body text-body-md text-neutral-500">{tenant.description}</p> : null}
        <Link
          className="mt-3 bg-[var(--store-primary)] px-5 py-2.5 font-label text-label-md text-white transition-opacity hover:opacity-90"
          href="#produtos"
        >
          Ver produtos
        </Link>
      </section>

      {categories.length > 0 ? (
        <nav className="flex flex-wrap justify-center gap-6 border-y border-neutral-100 py-4" id="categorias">
          {categories.map((category) => (
            <Link
              className={`font-label text-label-sm uppercase tracking-wide transition-colors hover:text-neutral-900 ${
                activeCategorySlug === category.slug ? "text-neutral-900" : "text-neutral-400"
              }`}
              href={`?categoria=${category.slug}#produtos`}
              key={category.id}
            >
              {category.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="mx-auto flex max-w-container-max flex-col gap-16 px-margin-mobile py-16 md:px-margin-desktop">
        <section id="produtos">
          {products.length === 0 ? (
            <p className="text-center font-body text-body-sm text-neutral-400">
              {searchQuery ? `Nenhum produto encontrado para "${searchQuery}".` : "Em breve, novos produtos por aqui."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-3">
              {products.map((product) => (
                <StorefrontProductCard key={product.id} product={product} storeSlug={tenant.slug} variant="minimal" />
              ))}
            </div>
          )}
        </section>

        {promotions.length > 0 ? (
          <section className="border border-neutral-200 px-6 py-10 text-center" id="promocoes">
            <p className="mb-1 font-label text-label-sm uppercase tracking-wide text-[var(--store-primary)]">Promoção</p>
            <h2 className="mb-6 font-display text-lg text-neutral-900">Peças com condição especial</h2>
            <div className="mx-auto grid max-w-3xl grid-cols-2 gap-x-6 gap-y-10 text-left md:grid-cols-3">
              {promotions.map((product) => (
                <StorefrontProductCard key={product.id} product={product} storeSlug={tenant.slug} variant="minimal" />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-lg text-center" id="sobre">
          <h2 className="mb-2 font-display text-base font-medium text-neutral-900">Sobre a loja</h2>
          <p className="font-body text-body-sm text-neutral-500">
            {tenant.description ?? `${tenant.name} é uma loja criada com VEXO.`}
          </p>
        </section>
      </div>
    </div>
  );
}
