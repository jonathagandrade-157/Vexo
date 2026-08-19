-- Etapa 12 — aplica o frete escolhido a um pedido já criado
-- (create_order_from_cart, Etapa 10, continua INALTERADA — este é um
-- passo separado, mesmo padrão de create_payment_for_order na Etapa
-- 11). anon-only, security definer: revalida tenant/pedido/modalidade e
-- SEMPRE relê o preço atual de shipping_methods — p_expected_price
-- serve só para detectar divergência (prompt §23: "se o valor tiver
-- mudado, não criar silenciosamente um pedido com valor diferente"),
-- nunca é usado como o valor final.
create function public.apply_shipping_to_order(
  p_tenant_id uuid,
  p_order_id uuid,
  p_shipping_method_id uuid,
  p_expected_price numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_method public.shipping_methods;
begin
  select * into v_order from public.orders where id = p_order_id and tenant_id = p_tenant_id;
  if v_order.id is null then
    raise exception 'order not found for this store' using errcode = 'P0002';
  end if;
  -- Frete só pode ser alterado enquanto o pedido ainda não avançou
  -- (nunca depois de pago) — evita reabrir um pedido já confirmado.
  if v_order.status <> 'PENDING' then
    raise exception 'order can no longer be changed' using errcode = 'P0002';
  end if;

  select * into v_method
  from public.shipping_methods
  where id = p_shipping_method_id and tenant_id = p_tenant_id and status = 'active';
  if v_method.id is null then
    raise exception 'shipping method not available' using errcode = 'P0002';
  end if;

  if abs(v_method.price - p_expected_price) > 0.01 then
    raise exception 'shipping price has changed' using errcode = 'P0002';
  end if;

  update public.orders
  set shipping_total = v_method.price,
      shipping_method = v_method.name,
      shipping_provider = v_method.type,
      shipping_estimated_days = v_method.estimated_days,
      shipping_reference = v_method.id::text,
      -- discount_total continua 0 nesta etapa — o check
      -- orders_total_matches_components (Etapa 10) já garante que este
      -- total bate com subtotal+frete-desconto, sem precisar repetir a
      -- fórmula manualmente aqui de um jeito que possa divergir dele.
      total = v_order.subtotal + v_method.price - v_order.discount_total
  where id = p_order_id and tenant_id = p_tenant_id;
end;
$$;

comment on function public.apply_shipping_to_order(uuid, uuid, uuid, numeric) is
  'Aplica/revalida o frete escolhido a um pedido PENDING recém-criado — sempre relê o preço atual de shipping_methods, nunca confia em p_expected_price como valor final (só para detectar divergência e recusar).';

revoke execute on function public.apply_shipping_to_order(uuid, uuid, uuid, numeric)
  from public, authenticated, service_role;
grant execute on function public.apply_shipping_to_order(uuid, uuid, uuid, numeric) to anon;
