import type { Metadata } from "next";
import Link from "next/link";

import { CartItemRow } from "@/components/storefront/cart-item-row";
import { CartSummary } from "@/components/storefront/cart-summary";
import { StorefrontEmptyState } from "@/components/storefront/storefront-empty-state";
import { StorefrontNotFound } from "@/components/storefront/storefront-not-found";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { getCart } from "@/features/cart/data";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";

/** Depende de `cookies()` (getCart) — sempre dinâmica, mesma razão das outras rotas do storefront a partir da Etapa 9. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Carrinho", robots: { index: false, follow: false } };

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Rota nova (Etapa 9). Vazio segue o mesmo padrão visual de
 * `StorefrontEmptyState` já usado em "categoria vazia"/"produto não
 * encontrado" — com "Continuar comprando" como ação (prompt §11).
 */
export default async function CartPage({ params }: PageProps) {
  const { slug } = await params;
  const resolution = await resolveStorefrontTenant(slug);

  if (resolution.status === "not_found") return <StorefrontNotFound />;

  if (resolution.status === "not_configured") {
    return (
      <StorefrontShell
        footer={{ description: null, instagramHandle: null, whatsappPhone: null, contactEmail: null }}
        storeName={resolution.name}
        storeSlug={slug}
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
  const cart = await getCart(tenant.slug);

  const shellFooter = {
    description: tenant.description,
    instagramHandle: tenant.instagram_handle,
    whatsappPhone: tenant.whatsapp_phone,
    contactEmail: tenant.contact_email,
  };

  return (
    <StorefrontShell cartCount={cart.itemCount} footer={shellFooter} storeName={tenant.name} storeSlug={tenant.slug}>
      <div className="mx-auto flex max-w-container-max flex-col gap-8 px-margin-mobile py-10 md:px-margin-desktop">
        <h1 className="font-headline text-headline-md text-on-surface">Seu carrinho</h1>

        {cart.items.length === 0 ? (
          <StorefrontEmptyState
            action={
              <Link
                className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6]"
                href={`/loja/${tenant.slug}`}
              >
                Continuar comprando
              </Link>
            }
            description="Adicione produtos para vê-los aqui."
            icon="shopping_cart"
            title="Seu carrinho está vazio"
          />
        ) : (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 md:col-span-2 md:px-6">
              {cart.items.map((item) => (
                <CartItemRow item={item} key={item.id} storeSlug={tenant.slug} />
              ))}
            </div>
            <div className="md:col-span-1">
              <CartSummary itemCount={cart.itemCount} storeSlug={tenant.slug} subtotal={cart.subtotal} />
            </div>
          </div>
        )}
      </div>
    </StorefrontShell>
  );
}
