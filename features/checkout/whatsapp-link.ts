import "server-only";

import { cache } from "react";

import { getStoreAddress } from "@/features/checkout/store-address";
import { buildWhatsappLink } from "@/lib/whatsapp/link";
import { buildOrderWhatsappMessage, type RequestedPaymentMethod, type WhatsappOrderAddress, type WhatsappOrderDelivery } from "@/lib/whatsapp/message";
import { normalizeBrazilianPhone } from "@/lib/whatsapp/phone";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

interface OrderRow {
  order_number: string;
  order_source: string;
  customer_name: string;
  customer_phone: string;
  subtotal: number;
  shipping_total: number;
  total: number;
  requested_payment_method: RequestedPaymentMethod | null;
  cash_change_for: number | null;
  /** D3.1 — sinal de verdade de "é retirada na loja", nunca inferido de `shipping_address IS NULL` (uma consequência, não a fonte). */
  shipping_provider: "flat_rate" | "own_delivery" | "pickup" | null;
  /** D3.1 — nulo quando a modalidade é retirada na loja; para as demais, sempre preenchido. */
  shipping_address: WhatsappOrderAddress | null;
}

interface OrderItemRow {
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

/**
 * Fase D2-B. Só produz link para pedidos `order_source = 'whatsapp'` —
 * nunca chamada/relevante para o caminho pago (Mercado Pago). Leitura via
 * service_role (mesmo padrão já usado por `features/payments/checkout.ts
 * ::initiatePaymentForOrder` para ler `orders.total/order_number`):
 * contexto de servidor confiável, nunca exposto a `anon`/cliente — por
 * isso pode incluir `customer_phone` (excluído de propósito da projeção
 * pública de `get_order_confirmation`), já que quem chama esta função é
 * sempre a própria página de confirmação do pedido, atrás do mesmo token
 * de posse (`tenant_id` + `order_id` uuid), nunca um endpoint novo exposto
 * a `anon`.
 *
 * O telefone de DESTINO é sempre `tenants.whatsapp_phone`, lido aqui —
 * nunca um parâmetro desta função, nunca aceito de fora.
 */
export const getWhatsappOrderLink = cache(async (tenantId: string, orderId: string): Promise<string | null> => {
  const supabase = createSupabaseServiceRoleClient();

  const [orderResult, itemsResult, tenantResult] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "order_number, order_source, customer_name, customer_phone, subtotal, shipping_total, total, requested_payment_method, cash_change_for, shipping_provider, shipping_address",
      )
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle<OrderRow>(),
    supabase
      .from("order_items")
      .select("product_name, quantity, unit_price, subtotal")
      .eq("order_id", orderId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .returns<OrderItemRow[]>(),
    supabase.from("tenants").select("whatsapp_phone").eq("id", tenantId).maybeSingle<{ whatsapp_phone: string | null }>(),
  ]);

  // Nunca engolir o erro em silêncio — sem isto, qualquer falha transitória
  // de rede/banco produzia exatamente a mesma mensagem genérica ao cliente,
  // sem nenhum rastro para diagnosticar depois. O log nunca inclui telefone,
  // nome, endereço ou qualquer dado do pedido — só o contexto técnico
  // (tenantId/orderId são UUIDs internos, não dado pessoal) e o erro do
  // Postgres/PostgREST em si (código/mensagem, nunca payload).
  if (orderResult.error) {
    console.error("[getWhatsappOrderLink] failed to load order", { tenantId, orderId, error: orderResult.error.message });
    return null;
  }
  if (itemsResult.error) {
    console.error("[getWhatsappOrderLink] failed to load order_items", { tenantId, orderId, error: itemsResult.error.message });
    return null;
  }
  if (tenantResult.error) {
    console.error("[getWhatsappOrderLink] failed to load tenant", { tenantId, orderId, error: tenantResult.error.message });
    return null;
  }

  const order = orderResult.data;
  const items = itemsResult.data;
  const tenant = tenantResult.data;

  if (!order || order.order_source !== "whatsapp" || !order.requested_payment_method || !tenant?.whatsapp_phone) return null;

  const destination = normalizeBrazilianPhone(tenant.whatsapp_phone);
  if (!destination) return null;

  // D3.1 (correção) — retirada na loja nunca tem endereço do cliente
  // (`shipping_address` é NULL nesse caso); o sinal de verdade é sempre
  // `shipping_provider`, nunca "endereço é nulo" (uma consequência, não a
  // fonte). O endereço da loja vem só de `getStoreAddress`
  // (`tenants.address_*`) — nunca uma segunda leitura/cópia.
  let delivery: WhatsappOrderDelivery;
  if (order.shipping_provider === "pickup") {
    const storeAddress = await getStoreAddress(tenantId);
    delivery = { kind: "pickup", storeAddress };
  } else if (order.shipping_address) {
    delivery = { kind: "address", address: order.shipping_address };
  } else {
    // Nunca deveria acontecer (toda modalidade que não é pickup exige
    // endereço já na criação do pedido) — mas se acontecer, é uma
    // inconsistência de dado real, não um "endereço em branco" para
    // inventar. Falha de forma segura, com rastro, em vez de lançar.
    console.error("[getWhatsappOrderLink] non-pickup order without shipping_address", { tenantId, orderId });
    return null;
  }

  const message = buildOrderWhatsappMessage({
    orderNumber: order.order_number,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    items: (items ?? []).map((item) => ({
      productName: item.product_name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      subtotal: item.subtotal,
    })),
    subtotal: order.subtotal,
    shippingTotal: order.shipping_total,
    total: order.total,
    delivery,
    requestedPaymentMethod: order.requested_payment_method,
    cashChangeFor: order.cash_change_for,
  });

  return buildWhatsappLink(destination, message);
});
