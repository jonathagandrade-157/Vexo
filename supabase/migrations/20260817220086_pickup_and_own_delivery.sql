-- D3.1: retirada na loja + entrega própria básica.
--
-- Estende o modelo de modalidades de entrega (shipping_methods) com dois
-- novos tipos genéricos, mantendo a arquitetura pronta para modalidades
-- futuras (frete por distância, Melhor Envio, Correios, transportadoras)
-- sem implementá-las agora.
--
-- Não remove nem altera shipping_settings.origin_zip. Não recria nenhuma
-- migration antiga.

-- 1. shipping_methods.type passa a aceitar 'pickup' e 'own_delivery',
--    além do 'flat_rate' já existente.
alter table public.shipping_methods
  drop constraint shipping_methods_type_check;

alter table public.shipping_methods
  add constraint shipping_methods_type_check
  check (type in ('flat_rate', 'own_delivery', 'pickup'));

-- 2. Retirada na loja nunca tem preço: o preço do frete é sempre 0 quando
--    type = 'pickup'. Isso remove a necessidade de qualquer tratamento
--    especial de preço para pickup nas camadas acima do banco.
alter table public.shipping_methods
  add constraint shipping_methods_pickup_price_zero_check
  check (type <> 'pickup' or price = 0);

-- 3. No máximo uma linha de 'pickup' e uma de 'own_delivery' por tenant
--    (configuração única, como shipping_settings). 'flat_rate' continua
--    sendo uma lista livre, sem essa restrição.
create unique index shipping_methods_tenant_singleton_type_idx
  on public.shipping_methods (tenant_id, type)
  where type in ('own_delivery', 'pickup');

-- 4. orders.shipping_address passa a poder ser nulo, para representar um
--    pedido com retirada na loja (sem endereço de entrega do cliente).
--    A constraint orders_shipping_address_check não precisa ser alterada:
--    ela só valida as chaves do jsonb quando ele não é nulo (uma expressão
--    CHECK que resulta em NULL, e não em FALSE, é considerada satisfeita).
alter table public.orders
  alter column shipping_address drop not null;

comment on column public.orders.shipping_address is
  'Endereço de entrega do cliente, congelado no momento do pedido. Nulo quando a modalidade escolhida é retirada na loja (shipping_provider = ''pickup''); nesse caso o endereço de retirada é o endereço da loja (tenants.address_*), nunca duplicado aqui.';

-- 5. apply_shipping_to_order: mesma assinatura (4 args), agora ciente de
--    pickup. Para pickup, o pedido não pode ter endereço de entrega (é
--    zerado explicitamente); para as demais modalidades, o endereço de
--    entrega do cliente continua obrigatório.
create or replace function public.apply_shipping_to_order(p_tenant_id uuid, p_order_id uuid, p_shipping_method_id uuid, p_expected_price numeric)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
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

  -- Retirada na loja não tem endereço de entrega do cliente; as demais
  -- modalidades exigem um endereço já congelado na criação do pedido.
  if v_method.type <> 'pickup' and v_order.shipping_address is null then
    raise exception 'order has no shipping address for this method' using errcode = 'P0002';
  end if;

  update public.orders
  set shipping_total = v_method.price,
      shipping_method = v_method.name,
      shipping_provider = v_method.type,
      shipping_estimated_days = v_method.estimated_days,
      shipping_reference = v_method.id::text,
      shipping_address = case when v_method.type = 'pickup' then null else v_order.shipping_address end,
      -- discount_total continua 0 nesta etapa — o check
      -- orders_total_matches_components (Etapa 10) já garante que este
      -- total bate com subtotal+frete-desconto, sem precisar repetir a
      -- fórmula manualmente aqui de um jeito que possa divergir dele.
      total = v_order.subtotal + v_method.price - v_order.discount_total
  where id = p_order_id and tenant_id = p_tenant_id;
end;
$function$;

-- 6. get_order_confirmation: mesma assinatura (2 args), agora também
--    expõe a modalidade/prazo de entrega já aplicados ao pedido, para a
--    página de confirmação distinguir retirada de entrega.
create or replace function public.get_order_confirmation(p_tenant_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
    'shippingMethod', v_order.shipping_method,
    'shippingProvider', v_order.shipping_provider,
    'shippingEstimatedDays', v_order.shipping_estimated_days,
    'subtotal', v_order.subtotal,
    'shippingTotal', v_order.shipping_total,
    'discountTotal', v_order.discount_total,
    'total', v_order.total,
    'createdAt', v_order.created_at,
    'items', v_items
  );
end;
$function$;
