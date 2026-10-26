-- Fase D2-B — estende get_order_confirmation (Etapa 10/11) para incluir
-- orderSource/requestedPaymentMethod/cashChangeFor. A página de
-- confirmação (app/loja/[slug]/pedido/[orderId]/page.tsx) precisa de
-- orderSource para decidir se mostra o fluxo "Pagamento pendente/
-- aprovado" (vexo_checkout) ou "Envie seu pedido pelo WhatsApp"
-- (whatsapp); requestedPaymentMethod/cashChangeFor são só exibidos,
-- nunca usados por nenhuma lógica financeira.
--
-- Continua sem telefone/e-mail do cliente na projeção (Etapa 10: "nunca
-- dado administrativo/PII de contato") — isso permanece exclusivo de
-- features/checkout/whatsapp-link.ts (leitura via service_role, nunca
-- exposta por esta função anon-callable).
create or replace function public.get_order_confirmation(p_tenant_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_items jsonb;
begin
  select * into v_order from public.orders where id = p_order_id and tenant_id = p_tenant_id;
  if v_order.id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'productName', oi.product_name,
    'productSlug', oi.product_slug,
    'quantity', oi.quantity,
    'unitPrice', oi.unit_price,
    'subtotal', oi.subtotal
  ) order by oi.created_at), '[]'::jsonb)
  into v_items
  from public.order_items oi
  where oi.order_id = p_order_id;

  return jsonb_build_object(
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'paymentStatus', v_order.payment_status,
    'orderSource', v_order.order_source,
    'requestedPaymentMethod', v_order.requested_payment_method,
    'cashChangeFor', v_order.cash_change_for,
    'customerName', v_order.customer_name,
    'shippingAddress', v_order.shipping_address,
    'subtotal', v_order.subtotal,
    'shippingTotal', v_order.shipping_total,
    'discountTotal', v_order.discount_total,
    'total', v_order.total,
    'createdAt', v_order.created_at,
    'items', v_items
  );
end;
$$;

comment on function public.get_order_confirmation(uuid, uuid) is
  'Leitura pública da confirmação de pedido, escopada por (tenant_id, order_id) — o order_id (uuid não adivinhável) é o token de posse, nunca o order_number sequencial. Projeção mínima, sem dado administrativo/PII de contato (telefone/e-mail do cliente nunca aparecem aqui — ver features/checkout/whatsapp-link.ts para o caminho que precisa deles). Fase D2-B: inclui orderSource/requestedPaymentMethod/cashChangeFor.';
