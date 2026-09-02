import type { Metadata } from "next";
import Link from "next/link";

import { CheckoutForm } from "@/components/storefront/checkout-form";
import { StorefrontEmptyState } from "@/components/storefront/storefront-empty-state";
import { StorefrontNotFound } from "@/components/storefront/storefront-not-found";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { getCart } from "@/features/cart/data";
import { effectivePrice, lineSubtotal } from "@/features/cart/pricing";
import { resolveCheckoutAvailability } from "@/features/checkout/checkout-availability";
import { getStorePixSettings } from "@/features/checkout/pix-settings";
import { getStoreAddress } from "@/features/checkout/store-address";
import { isPaymentGatewayConnected } from "@/features/payments/checkout";
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
  const [cart, gatewayConnected, storeAddress] = await Promise.all([
    getCart(tenant.slug),
    isPaymentGatewayConnected(tenant.id),
    // D3.1: endereço da loja para exibir quando o cliente escolher
    // retirada — sempre buscado, mesmo em lojas sem `pickup` configurado
    // ainda (mesmo padrão de pixSettings abaixo: quem decide o que fazer
    // com `null` é o CheckoutForm).
    getStoreAddress(tenant.id),
  ]);

  // D14.1 — única fonte de verdade de "o que esta loja oferece agora"
  // (features/checkout/checkout-availability.ts), a mesma usada por
  // CheckoutForm (só para UI) e por createOrderForWhatsappAction (a
  // autoridade real, refeita no servidor a cada submit — nunca confia
  // neste cálculo daqui). Cobre o caso novo: `checkout_mode = 'vexo'`
  // (o padrão de fábrica) sem gateway conectado deixa de ser
  // automaticamente um beco sem saída quando a loja já tem um WhatsApp
  // válido configurado — nunca muda `checkout_mode` para isso.
  const { onlineAllowed, whatsappAllowed } = resolveCheckoutAvailability(
    tenant.checkout_mode,
    gatewayConnected,
    tenant.whatsapp_phone,
  );

  // Só buscado quando o caminho WhatsApp existe de verdade (modo
  // `whatsapp`/`both`, ou o fallback acima) — uma loja `vexo` com
  // gateway conectado nunca mostra PIX direto, então nem vale ler a
  // configuração.
  const pixSettings = whatsappAllowed ? await getStorePixSettings(tenant.id) : null;

  const shellFooter = {
    description: tenant.description,
    instagramHandle: tenant.instagram_handle,
    whatsappPhone: tenant.whatsapp_phone,
    contactEmail: tenant.contact_email,
  };

  // Bloqueia ANTES do formulário, nunca mostra um "pagar" que não
  // funciona nem cria um pedido sem como ser pago (prompt Etapa 11 §19).
  // Só acontece de fato quando NENHUM caminho está disponível — hoje,
  // isso só é possível em `checkout_mode = 'vexo'` sem gateway conectado
  // E sem WhatsApp configurado (`whatsapp`/`both` sempre têm ao menos o
  // caminho WhatsApp, preservado sem alteração).
  if (!onlineAllowed && !whatsappAllowed) {
    return (
      <StorefrontShell
        cartCount={cart.itemCount}
        footer={shellFooter}
        logoUrl={tenant.logo_url}
        primaryColor={tenant.primary_color}
        secondaryColor={tenant.secondary_color}
        storefrontTemplate={tenant.storefront_template}
        storeName={tenant.name}
        storeSlug={tenant.slug}
      >
        <StorefrontEmptyState
          action={
            <Link
              className="rounded-lg border border-outline-variant/50 px-5 py-2.5 font-label text-label-md text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
              href={`/loja/${tenant.slug}/carrinho`}
            >
              Voltar ao carrinho
            </Link>
          }
          description="Esta loja ainda não configurou um meio de pagamento online. Peça ao lojista para configurar um meio de pagamento para continuar."
          icon="credit_card_off"
          title="Pagamento online indisponível"
        />
      </StorefrontShell>
    );
  }

  const availableItems = cart.items.filter((item) => item.available);

  // Checkout vazio é bloqueado (prompt §23.1) — nenhum item disponível, nada para finalizar.
  if (availableItems.length === 0) {
    return (
      <StorefrontShell
        cartCount={cart.itemCount}
        footer={shellFooter}
        logoUrl={tenant.logo_url}
        primaryColor={tenant.primary_color}
        secondaryColor={tenant.secondary_color}
        storefrontTemplate={tenant.storefront_template}
        storeName={tenant.name}
        storeSlug={tenant.slug}
      >
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
          checkoutMode={tenant.checkout_mode}
          gatewayConnected={gatewayConnected}
          hasUnavailableItems={cart.items.length !== availableItems.length}
          pixSettings={pixSettings}
          storeAddress={storeAddress}
          whatsappPhone={tenant.whatsapp_phone}
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
