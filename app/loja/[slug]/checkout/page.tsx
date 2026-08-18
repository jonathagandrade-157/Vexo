import type { Metadata } from "next";
import Link from "next/link";

import { CheckoutForm } from "@/components/storefront/checkout-form";
import { StorefrontEmptyState } from "@/components/storefront/storefront-empty-state";
import { StorefrontNotFound } from "@/components/storefront/storefront-not-found";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { getCart } from "@/features/cart/data";
import { effectivePrice, lineSubtotal } from "@/features/cart/pricing";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Nova rota (Etapa 10). Formulário único com seções, não um wizard (mesmo padrão dos formulários do painel). */
export default async function CheckoutPage({ params }: PageProps) {
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

  const availableItems = cart.items.filter((item) => item.available);

  // Checkout vazio é bloqueado (prompt §23.1) — nenhum item disponível, nada para finalizar.
  if (availableItems.length === 0) {
    return (
      <StorefrontShell cartCount={cart.itemCount} footer={shellFooter} storeName={tenant.name} storeSlug={tenant.slug}>
        <StorefrontEmptyState
          action={
            <Link
              className="rounded-lg bg-primary-container px-5 py-2.5 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6]"
              href={`/loja/${tenant.slug}`}
            >
              Continuar comprando
            </Link>
          }
          description="Adicione produtos ao carrinho antes de finalizar a compra."
          icon="shopping_cart"
          title="Seu carrinho está vazio"
        />
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell cartCount={cart.itemCount} footer={shellFooter} storeName={tenant.name} storeSlug={tenant.slug}>
      <div className="mx-auto flex max-w-container-max flex-col gap-8 px-margin-mobile py-10 md:px-margin-desktop">
        <h1 className="font-headline text-headline-md text-on-surface">Finalizar compra</h1>
        <CheckoutForm
          hasUnavailableItems={cart.items.length !== availableItems.length}
          items={availableItems.map((item) => ({
            name: item.product.name,
            quantity: item.quantity,
            unitPrice: effectivePrice(item.product),
            subtotal: lineSubtotal(item.product, item.quantity),
          }))}
          storeSlug={tenant.slug}
          subtotal={cart.subtotal}
        />
      </div>
    </StorefrontShell>
  );
}
