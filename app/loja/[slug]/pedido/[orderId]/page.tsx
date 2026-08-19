import type { Metadata } from "next";
import Link from "next/link";

import { OrderSummary } from "@/components/storefront/order-summary";
import { StorefrontEmptyState } from "@/components/storefront/storefront-empty-state";
import { StorefrontNotFound } from "@/components/storefront/storefront-not-found";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { getOrderConfirmation } from "@/features/checkout/order-confirmation";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pedido realizado", robots: { index: false, follow: false } };

interface PageProps {
  params: Promise<{ slug: string; orderId: string }>;
}

/**
 * Nunca assumir pago só porque o cliente voltou para esta página
 * (prompt Etapa 11 §9/§18) — sempre o status real, lido do banco
 * (`get_order_confirmation`, atualizado só pelo webhook).
 */
const PAYMENT_STATUS_COPY: Record<
  "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "REFUNDED",
  { icon: string; label: string; description: string }
> = {
  PENDING: {
    icon: "hourglass_top",
    label: "Pagamento pendente",
    description: "Estamos aguardando a confirmação do seu pagamento. Isso pode levar alguns instantes.",
  },
  APPROVED: {
    icon: "check_circle",
    label: "Pagamento aprovado",
    description: "Seu pagamento foi confirmado — o pedido já está sendo preparado.",
  },
  REJECTED: {
    icon: "cancel",
    label: "Pagamento recusado",
    description: "O pagamento não foi aprovado. Você pode tentar novamente pelo carrinho.",
  },
  CANCELLED: {
    icon: "cancel",
    label: "Pagamento cancelado",
    description: "O pagamento foi cancelado.",
  },
  REFUNDED: {
    icon: "replay",
    label: "Pagamento reembolsado",
    description: "O valor deste pedido foi reembolsado.",
  },
};
export default async function OrderConfirmationPage({ params }: PageProps) {
  const { slug, orderId } = await params;
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
  const order = await getOrderConfirmation(tenant.id, orderId);

  const shellFooter = {
    description: tenant.description,
    instagramHandle: tenant.instagram_handle,
    whatsappPhone: tenant.whatsapp_phone,
    contactEmail: tenant.contact_email,
  };

  if (!order) {
    return (
      <StorefrontShell footer={shellFooter} storeName={tenant.name} storeSlug={tenant.slug}>
        <StorefrontEmptyState
          description="Não foi possível encontrar este pedido."
          icon="search_off"
          title="Pedido não encontrado"
        />
      </StorefrontShell>
    );
  }

  const paymentCopy = PAYMENT_STATUS_COPY[order.paymentStatus];

  return (
    <StorefrontShell footer={shellFooter} storeName={tenant.name} storeSlug={tenant.slug}>
      <div className="mx-auto flex max-w-container-max flex-col gap-8 px-margin-mobile py-10 md:px-margin-desktop">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-container">
            <span className="material-symbols-outlined text-3xl text-on-primary-container">{paymentCopy.icon}</span>
          </div>
          <h1 className="font-headline text-headline-md text-on-surface">Pedido recebido!</h1>
          <p className="font-body text-body-md text-on-surface-variant">
            Obrigado, {order.customerName}. Seu pedido é o <strong>{order.orderNumber}</strong>.
          </p>
          <p className="font-label text-label-md text-on-surface">
            {paymentCopy.label} — {paymentCopy.description}
          </p>
        </div>

        <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-6">
          <OrderSummary
            discountTotal={order.discountTotal}
            items={order.items.map((item) => ({
              name: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
            }))}
            shippingTotal={order.shippingTotal}
            subtotal={order.subtotal}
            total={order.total}
          />

          <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
            <h2 className="mb-3 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
              <span className="material-symbols-outlined text-primary">local_shipping</span>
              Endereço de entrega
            </h2>
            <p className="font-body text-body-sm text-on-surface-variant">
              {order.shippingAddress.street}, {order.shippingAddress.number}
              {order.shippingAddress.complement ? ` — ${order.shippingAddress.complement}` : ""}
              <br />
              {order.shippingAddress.neighborhood} — {order.shippingAddress.city}/{order.shippingAddress.state}
              <br />
              CEP {order.shippingAddress.zip.replace(/(\d{5})(\d{3})/, "$1-$2")}
            </p>
          </div>

          <Link
            className="mx-auto rounded-lg border border-outline-variant/50 px-5 py-2.5 font-label text-label-md text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
            href={`/loja/${tenant.slug}`}
          >
            Voltar para a loja
          </Link>
        </div>
      </div>
    </StorefrontShell>
  );
}
