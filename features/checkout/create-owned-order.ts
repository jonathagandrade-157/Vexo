import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type CheckoutShippingSelection =
  | { kind: "none" }
  | { kind: "method"; methodId: string; expectedPrice: number }
  | {
      kind: "melhor_envio";
      serviceId: string;
      name: string;
      price: number;
      estimatedDays: number | null;
    };

interface CreateOwnedOrderInput {
  tenantId: string;
  cartId: string;
  ownerTokenHash: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: Record<string, string | null> | null;
  orderSource: "vexo_checkout" | "whatsapp";
  paymentChannel: "gateway" | "external";
  requestedPaymentMethod: string | null;
  cashChangeFor: number | null;
  shipping: CheckoutShippingSelection;
}

export type CreateOwnedOrderResult =
  | { ok: true; orderId: string; created: boolean }
  | { ok: false; error: string };

interface SecureCheckoutRow {
  orderId?: unknown;
  created?: unknown;
}

/**
 * Único adaptador da aplicação para o checkout privilegiado. A RPC é
 * service-role-only e revalida a posse no PostgreSQL antes de reservar
 * estoque ou criar qualquer pedido.
 */
export async function createOwnedOrder(input: CreateOwnedOrderInput): Promise<CreateOwnedOrderResult> {
  const shippingMethod = input.shipping.kind === "method" ? input.shipping : null;
  const melhorEnvio = input.shipping.kind === "melhor_envio" ? input.shipping : null;

  const { data, error } = await createSupabaseServiceRoleClient().rpc("checkout_cart_secure", {
    p_tenant_id: input.tenantId,
    p_cart_id: input.cartId,
    p_owner_token_hash: input.ownerTokenHash,
    p_customer_name: input.customerName,
    p_customer_email: input.customerEmail,
    p_customer_phone: input.customerPhone,
    p_shipping_address: input.shippingAddress,
    p_order_source: input.orderSource,
    p_payment_channel: input.paymentChannel,
    p_requested_payment_method: input.requestedPaymentMethod,
    p_cash_change_for: input.cashChangeFor,
    p_shipping_kind: input.shipping.kind,
    p_shipping_method_id: shippingMethod?.methodId ?? null,
    p_expected_shipping_price: shippingMethod?.expectedPrice ?? null,
    p_me_service_id: melhorEnvio?.serviceId ?? null,
    p_me_service_name: melhorEnvio?.name ?? null,
    p_me_price: melhorEnvio?.price ?? null,
    p_me_estimated_days: melhorEnvio?.estimatedDays ?? null,
  });

  if (error) return { ok: false, error: error.message };

  const result = data as SecureCheckoutRow | null;
  if (typeof result?.orderId !== "string" || typeof result.created !== "boolean") {
    return { ok: false, error: "invalid secure checkout response" };
  }
  return { ok: true, orderId: result.orderId, created: result.created };
}
