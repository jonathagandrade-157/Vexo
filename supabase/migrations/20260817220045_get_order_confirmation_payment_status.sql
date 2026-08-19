-- Etapa 11 — estende get_order_confirmation (Etapa 10) para incluir o
-- status real do pagamento. Nunca assumir pago só porque o cliente
-- voltou para a página de sucesso (prompt §9) — a confirmação agora
-- mostra o status de verdade, lido do banco.
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
