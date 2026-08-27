import "server-only";

import { cache } from "react";

import type { RequestedPaymentMethod } from "@/lib/whatsapp/message";
import { createSupabasePublicClient } from "@/lib/supabase/server";

export interface OrderConfirmationItem {
  productName: string;
  productSlug: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
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
 * `orderId` (uuid) é o token de posse (não adivinhável) — nunca o
 * order_number sequencial (arquitetura Etapa 10 §11). `tenantId` sempre
 * vem de `resolveStorefrontTenant(slug)`, nunca de parâmetro solto.
 */
export const getOrderConfirmation = cache(
  async (tenantId: string, orderId: string): Promise<OrderConfirmation | null> => {
    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase.rpc("get_order_confirmation", {
      p_tenant_id: tenantId,
      p_order_id: orderId,
    });
    if (error || !data) return null;
    return data as unknown as OrderConfirmation;
  },
);
