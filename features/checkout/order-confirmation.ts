import "server-only";

import { cache } from "react";

import type { RequestedPaymentMethod } from "@/lib/whatsapp/message";
import { createSupabasePublicClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/** D20.5 — snapshot de um par opção/valor da variante comprada, na ordem de exibição (product_options.position) no momento da compra. */
export interface OrderConfirmationVariantOption {
  option: string;
  value: string;
}

export interface OrderConfirmationItem {
  productName: string;
  productSlug: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  /** D20.5 — null para produto simples, ou quando a variante comprada foi excluída depois (variantSku/variantLabel/variantOptions continuam preenchidos nesse caso — o snapshot nunca desaparece). */
  variantId: string | null;
  variantSku: string | null;
  variantLabel: string | null;
  variantOptions: OrderConfirmationVariantOption[] | null;
}

export interface OrderConfirmation {
  orderNumber: string;
  status: string;
  /** Nunca assumir pago só porque o cliente voltou para esta página (prompt Etapa 11 §9/§18) — sempre o status real, lido do banco. EXTERNAL (Fase D2-B) é terminal, exclusivo de pedidos orderSource='whatsapp'. */
  paymentStatus: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "REFUNDED" | "EXTERNAL";
  /** Fase D2-B — por qual fluxo este pedido foi criado. Nunca 'both': isso é uma configuração da loja (tenants.checkout_mode), não um fato do pedido. */
  orderSource: "vexo_checkout" | "whatsapp";
  /** Fase D2-B — preferência informativa do fluxo WhatsApp, nunca processada pela VEXO. null para pedidos orderSource='vexo_checkout'. */
  requestedPaymentMethod: RequestedPaymentMethod | null;
  /** Fase D2-B — só para requestedPaymentMethod='cash'. Quanto o cliente vai pagar (nunca o troco em si, sempre recalculado como cashChangeFor - total). null = sem troco ou não aplicável. */
  cashChangeFor: number | null;
  customerName: string;
  /** D3.1: nulo quando a modalidade é retirada na loja (shippingProvider = 'pickup') — nunca o endereço da loja usado como se fosse do cliente. */
  shippingAddress: {
    zip: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
  } | null;
  /** D3.1: nome da modalidade aplicada ao pedido (snapshot, migration 048/086) — null se nenhum frete foi aplicado (loja sem entrega configurada). */
  shippingMethod: string | null;
  /** D3.1: tipo da modalidade aplicada (`flat_rate` | `own_delivery` | `pickup`) — usado para decidir "Retirar na loja" vs. "Entrega". */
  shippingProvider: "flat_rate" | "own_delivery" | "pickup" | null;
  shippingEstimatedDays: number | null;
  subtotal: number;
  shippingTotal: number;
  discountTotal: number;
  total: number;
  createdAt: string;
  items: OrderConfirmationItem[];
}

/**
 * Leitura da confirmação. NUNCA chamar sem antes validar a prova de posse
 * (`verifyOrderAccess`, features/checkout/order-access.ts) — o `orderId`
 * sozinho deixou de ser credencial. `tenantId` sempre vem de
 * `resolveStorefrontTenant(slug)`, nunca de parâmetro solto.
 *
 * A RPC passa a ser exclusiva de service_role (migration
 * 20261107120000_order_confirmation_service_role_only.sql). Enquanto essa
 * migration não estiver aplicada, service_role ainda não tem EXECUTE e o
 * banco responde 42501: só nesse caso a leitura cai para o contrato antigo
 * (anon), preservando o funcionamento durante o rollout em qualquer ordem
 * (código antes ou depois da migration). Remover o fallback após aplicar.
 */
export const getOrderConfirmation = cache(
  async (tenantId: string, orderId: string): Promise<OrderConfirmation | null> => {
    const args = { p_tenant_id: tenantId, p_order_id: orderId };
    const privileged = await createSupabaseServiceRoleClient().rpc("get_order_confirmation", args);
    if (!privileged.error) return (privileged.data as unknown as OrderConfirmation | null) ?? null;

    if (privileged.error.code !== "42501") {
      console.error("[getOrderConfirmation] failed to load order confirmation", { code: privileged.error.code });
      return null;
    }

    const legacy = await createSupabasePublicClient().rpc("get_order_confirmation", args);
    if (legacy.error || !legacy.data) return null;
    return legacy.data as unknown as OrderConfirmation;
  },
);
