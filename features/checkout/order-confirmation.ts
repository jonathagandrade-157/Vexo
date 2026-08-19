import "server-only";

import { cache } from "react";

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
  /** Nunca assumir pago só porque o cliente voltou para esta página (prompt Etapa 11 §9/§18) — sempre o status real, lido do banco. */
  paymentStatus: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "REFUNDED";
  customerName: string;
  shippingAddress: {
    zip: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
  };
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
