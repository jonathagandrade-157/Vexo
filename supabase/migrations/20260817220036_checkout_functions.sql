-- Etapa 10 — funções do checkout. Ambas security definer, anon-only:
-- `anon` não tem nenhuma policy/grant direto em orders/order_items (ver
-- migration de RLS) — só estas duas funções conseguem escrever/ler,
-- cada uma validando tudo internamente, nunca confiando em input do
-- cliente como autoridade (arquitetura §5.3, prompt §7/§8).
create function public.create_order_from_cart(
  p_tenant_id uuid,
  p_cart_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping_address jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_tenant uuid;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(10, 2) := 0;
  v_item record;
  v_item_count integer := 0;
begin
  -- Trava o carrinho: é a estratégia anti-duplicidade (prompt §9). Uma
  -- segunda chamada concorrente para o MESMO carrinho (double
  -- click/refresh/retry) fica bloqueada aqui até a primeira
  -- commitar (e já ter esvaziado o carrinho — a segunda encontra
  -- v_item_count = 0 e aborta com erro amigável, nunca um pedido
  -- duplicado) ou abortar (lock liberado sem nada ter mudado).
  select tenant_id into v_cart_tenant
  from public.carts
  where id = p_cart_id
  for update;

  if v_cart_tenant is null or v_cart_tenant <> p_tenant_id then
    raise exception 'cart not found for this store' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.status not in ('suspended', 'deleted')) then
    raise exception 'store is not available' using errcode = 'P0002';
  end if;

  v_order_number := 'PED' || lpad(nextval('public.orders_order_number_seq')::text, 6, '0');

  insert into public.orders (
    tenant_id, order_number, status, customer_name, customer_email, customer_phone,
    shipping_address, subtotal, discount_total, shipping_total, total
  ) values (
    p_tenant_id, v_order_number, 'PENDING', p_customer_name, p_customer_email, p_customer_phone,
    p_shipping_address, 0, 0, 0, 0
  )
  returning id into v_order_id;

  -- Preço sempre lido AO VIVO de products aqui dentro — nunca de
  -- cart_items (que nem armazena preço, Etapa 9) nem de qualquer valor
  -- vindo do cliente. Qualquer produto excluído/de outro
  -- tenant/inativo aborta a função inteira (nenhuma escrita parcial —
  -- é uma única transação Postgres).
  for v_item in
    select ci.product_id, ci.quantity, p.name, p.slug, p.price, p.promotional_price, p.status,
           p.tenant_id as product_tenant_id
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    where ci.cart_id = p_cart_id and ci.tenant_id = p_tenant_id
  loop
    if v_item.product_tenant_id <> p_tenant_id or v_item.status <> 'active' then
      raise exception 'product % is no longer available', v_item.name using errcode = 'P0001';
    end if;

    insert into public.order_items (
      order_id, tenant_id, product_id, product_name, product_slug, quantity, unit_price, subtotal
    ) values (
      v_order_id, p_tenant_id, v_item.product_id, v_item.name, v_item.slug, v_item.quantity,
      coalesce(v_item.promotional_price, v_item.price),
      coalesce(v_item.promotional_price, v_item.price) * v_item.quantity
    );

    v_subtotal := v_subtotal + coalesce(v_item.promotional_price, v_item.price) * v_item.quantity;
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count = 0 then
    raise exception 'cart is empty' using errcode = 'P0002';
  end if;

  -- shipping_total/discount_total permanecem 0 (checks da tabela já
  -- impediriam outro valor de qualquer forma).
  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;

  delete from public.cart_items where cart_id = p_cart_id and tenant_id = p_tenant_id;

  return v_order_id;
end;
$$;

comment on function public.create_order_from_cart(uuid, uuid, text, text, text, jsonb) is
  'Cria pedido a partir do carrinho, atomicamente (transação única) — preço/total sempre recalculados no servidor, nunca aceitos do cliente. Lock do carrinho (for update) é a estratégia anti-duplicidade.';

revoke execute on function public.create_order_from_cart(uuid, uuid, text, text, text, jsonb)
  from public, authenticated, service_role;
grant execute on function public.create_order_from_cart(uuid, uuid, text, text, text, jsonb) to anon;

-- Leitura da confirmação: `order_number` é sequencial/adivinhável (só
-- para exibição humana) — usar isso como chave de busca seria um IDOR
-- real (enumerar pedidos de outros clientes). A página de confirmação
-- usa o `id` (uuid, não adivinhável) como o token de posse, mesmo
-- modelo do cart_id. Projeção mínima: nunca tenant_id, id interno de
-- order_items, product_id, e-mail ou telefone do cliente.
create function public.get_order_confirmation(p_tenant_id uuid, p_order_id uuid)
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
  'Leitura pública da confirmação de pedido, escopada por (tenant_id, order_id) — o order_id (uuid não adivinhável) é o token de posse, nunca o order_number sequencial. Projeção mínima, sem dado administrativo/PII de contato.';

revoke execute on function public.get_order_confirmation(uuid, uuid)
  from public, authenticated, service_role;
grant execute on function public.get_order_confirmation(uuid, uuid) to anon;
