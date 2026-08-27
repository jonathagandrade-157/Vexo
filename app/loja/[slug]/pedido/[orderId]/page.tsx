import type { Metadata } from "next";
import Link from "next/link";

import { OrderSummary } from "@/components/storefront/order-summary";
import { StorefrontEmptyState } from "@/components/storefront/storefront-empty-state";
import { StorefrontNotFound } from "@/components/storefront/storefront-not-found";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { getOrderConfirmation } from "@/features/checkout/order-confirmation";
import { getWhatsappOrderLink } from "@/features/checkout/whatsapp-link";
import { resolveStorefrontTenant } from "@/features/storefront/resolve-tenant";
import type { RequestedPaymentMethod } from "@/lib/whatsapp/message";

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
  "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "REFUNDED" | "EXTERNAL",
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
  // Fase D2-B — nunca renderizado de fato pelo fluxo normal (pedidos
  // orderSource='whatsapp' usam o ramo dedicado abaixo, não este mapa),
  // mas mantido aqui como fallback seguro caso algum dia um pedido
  // EXTERNAL acabe passando pelo caminho de renderização tradicional.
  EXTERNAL: {
    icon: "chat",
    label: "Pagamento combinado no WhatsApp",
    description: "O pagamento deste pedido é combinado diretamente com a loja.",
  },
};

/**
 * Fase D2-B (revisão final) — copy específica por forma de pagamento
 * (prompt §19): PIX pede o comprovante na conversa, dinheiro reforça o
 * troco informado, cartão só confirma a preferência. Nunca afirma
 * "pagamento aprovado" para nenhum destes — o pedido continua
 * `payment_status='EXTERNAL'`, sempre "aguardando confirmação da loja".
 */
function whatsappInstructionFor(method: RequestedPaymentMethod, cashChangeFor: number | null, total: number): string {
  if (method === "pix") {
    return "Após realizar o pagamento, envie o comprovante nesta conversa.";
  }
  if (method === "cash") {
    return cashChangeFor === null
      ? "Pagamento em dinheiro, sem necessidade de troco."
      : `Informe o troco corretamente: você pagará ${cashChangeFor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}, troco de ${(cashChangeFor - total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`;
  }
  return "Você informou cartão como forma de pagamento.";
}

function whatsappButtonLabel(method: RequestedPaymentMethod): string {
  return method === "pix" ? "Enviar pedido e comprovante pelo WhatsApp" : "Enviar pedido pelo WhatsApp";
}

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
      <StorefrontShell
        footer={shellFooter}
        logoUrl={tenant.logo_url}
        primaryColor={tenant.primary_color}
        secondaryColor={tenant.secondary_color}
        storefrontTemplate={tenant.storefront_template}
        storeName={tenant.name}
        storeSlug={tenant.slug}
      >
        <StorefrontEmptyState
          description="Não foi possível encontrar este pedido."
          icon="search_off"
          title="Pedido não encontrado"
        />
      </StorefrontShell>
    );
  }

  // Fase D2-B — pedido criado pelo fluxo WhatsApp: o link já é montado
  // inteiramente no servidor (features/checkout/whatsapp-link.ts), a
  // partir só de (tenant_id, order_id) — o mesmo par que já é o token de
  // posse desta página. Nunca reconstruído no cliente, nunca passado por
  // querystring.
  const isWhatsappOrder = order.orderSource === "whatsapp";
  const whatsappLink = isWhatsappOrder ? await getWhatsappOrderLink(tenant.id, orderId) : null;
  const paymentCopy = PAYMENT_STATUS_COPY[order.paymentStatus];

  return (
    <StorefrontShell footer={shellFooter} storeName={tenant.name} storeSlug={tenant.slug}>
      <div className="mx-auto flex max-w-container-max flex-col gap-8 px-margin-mobile py-10 md:px-margin-desktop">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-container">
            <span className="material-symbols-outlined text-3xl text-on-primary-container">
              {isWhatsappOrder ? "chat" : paymentCopy.icon}
            </span>
          </div>
          <h1 className="font-headline text-headline-md text-on-surface">
            {isWhatsappOrder ? "Pedido criado com sucesso!" : "Pedido recebido!"}
          </h1>
          <p className="font-body text-body-md text-on-surface-variant">
            Obrigado, {order.customerName}. Seu pedido é o <strong>{order.orderNumber}</strong>.
          </p>
          {isWhatsappOrder && order.requestedPaymentMethod ? (
            <>
              <p className="font-label text-label-md text-on-surface">
                Envie seu pedido pelo WhatsApp para confirmar com a loja.
              </p>
              <p className="font-body text-body-sm text-on-surface-variant">
                {whatsappInstructionFor(order.requestedPaymentMethod, order.cashChangeFor, order.total)}
              </p>
              <p className="font-body text-body-sm text-on-surface-variant">
                Pagamento externo — aguardando confirmação da loja.
              </p>
              {whatsappLink ? (
                <a
                  className="mt-2 flex items-center gap-2 rounded-lg bg-[#25D366] px-6 py-3 font-label text-label-md text-white transition-colors hover:bg-[#1FB855]"
                  href={whatsappLink}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span className="material-symbols-outlined text-[20px]">chat</span>
                  {whatsappButtonLabel(order.requestedPaymentMethod)}
                </a>
              ) : (
                <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error">
                  Não foi possível montar o link do WhatsApp. Entre em contato com a loja diretamente.
                </p>
              )}
            </>
          ) : (
            <p className="font-label text-label-md text-on-surface">
              {paymentCopy.label} — {paymentCopy.description}
            </p>
          )}
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
