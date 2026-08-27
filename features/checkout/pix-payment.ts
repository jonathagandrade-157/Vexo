import "server-only";

import { cache } from "react";

import { buildPixPayload } from "@/lib/pix/payload";
import type { PixKeyType } from "@/lib/pix/key-types";
import { renderPixQrCodeSvg } from "@/lib/pix/qr-code";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export interface PixPaymentDetails {
  pixKey: string;
  pixKeyType: PixKeyType;
  recipientName: string;
  amount: number;
  copyPasteCode: string;
  qrCodeSvg: string;
}

interface OrderRow {
  order_number: string;
  order_source: string;
  payment_channel: string;
  requested_payment_method: string | null;
  total: number;
}

interface TenantPixRow {
  pix_enabled: boolean;
  pix_key: string | null;
  pix_key_type: PixKeyType | null;
  pix_recipient_name: string | null;
  address_city: string | null;
}

/**
 * Fase D2-B.2. Só produz o BR Code/QR Code para pedidos
 * `requested_payment_method='pix'` e `payment_channel='external'` — nunca
 * para o caminho pago (Mercado Pago). Mesmo padrão de
 * `features/checkout/whatsapp-link.ts::getWhatsappOrderLink`: leitura via
 * service_role (contexto de servidor confiável, nunca exposto a
 * `anon`/cliente diretamente), escopada por (tenant_id, order_id) — o
 * mesmo par que já é o token de posse da página de confirmação.
 *
 * O valor (`amount`) vem sempre de `orders.total` (já calculado e
 * validado pela RPC `create_order_from_cart` no momento da criação do
 * pedido) — nunca recalculado aqui a partir de nada enviado pelo cliente.
 * A chave/tipo/nome/cidade vêm sempre da configuração atual do tenant —
 * nunca de parâmetro desta função, nunca aceitos de fora.
 *
 * Retorna `null` sempre que o pedido não é PIX externo, ou quando a
 * configuração de PIX da loja está incompleta/desabilitada (nunca gera um
 * BR Code parcial) — quem chama decide o que exibir (ex.: instrução para
 * falar com a loja em vez de um QR quebrado).
 */
export const getPixPaymentDetails = cache(async (tenantId: string, orderId: string): Promise<PixPaymentDetails | null> => {
  const supabase = createSupabaseServiceRoleClient();

  const [{ data: order }, { data: tenant }] = await Promise.all([
    supabase
      .from("orders")
      .select("order_number, order_source, payment_channel, requested_payment_method, total")
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle<OrderRow>(),
    supabase
      .from("tenants")
      .select("pix_enabled, pix_key, pix_key_type, pix_recipient_name, address_city")
      .eq("id", tenantId)
      .maybeSingle<TenantPixRow>(),
  ]);

  if (!order || order.payment_channel !== "external" || order.requested_payment_method !== "pix") return null;
  if (!tenant?.pix_enabled || !tenant.pix_key || !tenant.pix_key_type || !tenant.pix_recipient_name || !tenant.address_city) return null;
  if (!Number.isFinite(order.total) || order.total <= 0) return null;

  let copyPasteCode: string;
  try {
    copyPasteCode = buildPixPayload({
      pixKey: tenant.pix_key,
      pixKeyType: tenant.pix_key_type,
      recipientName: tenant.pix_recipient_name,
      city: tenant.address_city,
      amount: order.total,
      txid: order.order_number,
    });
  } catch {
    return null;
  }

  const qrCodeSvg = await renderPixQrCodeSvg(copyPasteCode);

  return {
    pixKey: tenant.pix_key,
    pixKeyType: tenant.pix_key_type,
    recipientName: tenant.pix_recipient_name,
    amount: order.total,
    copyPasteCode,
    qrCodeSvg,
  };
});
