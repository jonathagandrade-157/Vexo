import "server-only";

import { cache } from "react";

import { buildWhatsappLink } from "@/lib/whatsapp/link";
import { buildOrderWhatsappMessage, type RequestedPaymentMethod } from "@/lib/whatsapp/message";
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
  shipping_address: {
    zip: string;
    street: string;
    number: string;
    complement: string | null;
    neighborhood: string;
    city: string;
    state: string;
  };
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

  const [{ data: order }, { data: items }, { data: tenant }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "order_number, order_source, customer_name, customer_phone, subtotal, shipping_total, total, requested_payment_method, cash_change_for, shipping_address",
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

  if (!order || order.order_source !== "whatsapp" || !order.requested_payment_method || !tenant?.whatsapp_phone) return null;

  const destination = normalizeBrazilianPhone(tenant.whatsapp_phone);
  if (!destination) return null;

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
    shippingAddress: order.shipping_address,
    requestedPaymentMethod: order.requested_payment_method,
    cashChangeFor: order.cash_change_for,
  });

  return buildWhatsappLink(destination, message);
});
