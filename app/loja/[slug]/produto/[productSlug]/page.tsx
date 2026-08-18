import type { Metadata } from "next";
import Link from "next/link";

import { StorefrontEmptyState } from "@/components/storefront/storefront-empty-state";
import { StorefrontNotFound } from "@/components/storefront/storefront-not-found";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { formatPrice } from "@/features/products/format-price";
import { getStorefrontProduct } from "@/features/storefront/catalog";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import { getPublicEnv } from "@/lib/env";

export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string; productSlug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const resolution = await resolveStorefrontTenant(slug);
  if (resolution.status !== "ready") {
    return { title: "Loja não encontrada — VEXO", robots: { index: false, follow: false } };
  }

  const product = await getStorefrontProduct(resolution.tenant.id, productSlug);
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();

  if (!product) {
    return { title: `Produto não encontrado — ${resolution.tenant.name}`, robots: { index: false, follow: false } };
  }

  const canonical = `${NEXT_PUBLIC_SITE_URL}/loja/${slug}/produto/${productSlug}`;
  const description = product.description ?? `${product.name} — disponível em ${resolution.tenant.name}.`;

  return {
    title: `${product.name} — ${resolution.tenant.name}`,
    description,
    alternates: { canonical },
    openGraph: { title: product.name, description, url: canonical, type: "website" },
  };
}

/**
 * Só a estrutura do card de `vexo_storefront_produto_desktop` (Stitch) —
 * sem "adicionar ao carrinho"/comprar (arquitetura §16 Etapa 7:
 * storefront não tem carrinho/checkout/compra nesta etapa).
 */
export default async function StorefrontProductPage({ params }: PageProps) {
  const { slug, productSlug } = await params;
  const resolution = await resolveStorefrontTenant(slug);

  if (resolution.status === "not_found") return <StorefrontNotFound />;

  if (resolution.status === "not_configured") {
    return (
      <StorefrontShell
        footer={{ description: null, instagramHandle: null, whatsappPhone: null, contactEmail: null }}
        storeName={resolution.name}
      >
        <StorefrontEmptyState
          description="O proprietário ainda está configurando esta loja. Volte em breve."
          icon="storefront"
          title="Esta loja ainda está sendo configurada"
        />
      </StorefrontShell>
    );
  }

  const { tenant } = resolution;
  const product = await getStorefrontProduct(tenant.id, productSlug);

  const shellFooter = {
    description: tenant.description,
    instagramHandle: tenant.instagram_handle,
    whatsappPhone: tenant.whatsapp_phone,
    contactEmail: tenant.contact_email,
  };

  if (!product) {
    return (
      <StorefrontShell footer={shellFooter} storeName={tenant.name}>
        <StorefrontEmptyState
          description="Este produto não existe ou não está mais disponível."
          icon="search_off"
          title="Produto não encontrado"
        />
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell footer={shellFooter} storeName={tenant.name}>
      <div className="mx-auto flex max-w-container-max flex-col gap-8 px-margin-mobile py-10 md:px-margin-desktop">
        <Link
          className="flex w-fit items-center gap-1 font-label text-label-sm text-on-surface-variant transition-colors hover:text-primary"
          href={`/loja/${tenant.slug}`}
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Voltar para a loja
        </Link>

        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <div className="aspect-square overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low">
            <div className="flex h-full w-full items-center justify-center">
              <span className="material-symbols-outlined text-6xl text-outline">image</span>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {product.category ? (
              <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                {product.category.name}
              </span>
            ) : null}
            <h1 className="font-display text-display-lg-mobile text-on-surface md:text-display-lg">
              {product.name}
            </h1>
            <div className="flex items-center gap-3">
              {product.promotional_price !== null ? (
                <>
                  <span className="font-headline text-headline-md text-on-surface">
                    {formatPrice(product.promotional_price)}
                  </span>
                  <span className="font-body text-body-lg text-on-surface-variant line-through">
                    {formatPrice(product.price)}
                  </span>
                </>
              ) : (
                <span className="font-headline text-headline-md text-on-surface">
                  {formatPrice(product.price)}
                </span>
              )}
            </div>
            {product.description ? (
              <p className="font-body text-body-lg text-on-surface-variant">{product.description}</p>
            ) : null}
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}
