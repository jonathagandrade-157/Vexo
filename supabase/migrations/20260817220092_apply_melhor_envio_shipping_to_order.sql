-- D3.2-B Ponto 2E — aplica ao pedido uma cotação Melhor Envio já
-- revalidada em Node (features/shipping/melhor-envio-checkout.ts), logo
-- após uma chamada HTTP fresca a calculateShipmentQuote() na MESMA
-- requisição. Mesmo papel de public.apply_shipping_to_order (migration
-- 048/086), mas nunca a mesma função: aquela sempre relê
-- shipping_methods.price dentro do Postgres como fonte de verdade — para
-- Melhor Envio não existe uma linha de shipping_methods para reler (a
-- fonte de verdade é a resposta HTTP viva do Melhor Envio, e "nunca
-- chamada HTTP dentro do Postgres" é uma regra explícita desta etapa).
--
-- DECISÃO DE SEGURANÇA CENTRAL desta migration: por isso mesmo, esta
-- função NÃO pode ser `anon`-only como apply_shipping_to_order — ela não
-- tem como revalidar p_price/p_service_id sozinha (não há tabela para
-- comparar), então um `anon` LIVRE poderia chamá-la diretamente (fora do
-- fluxo de checkout) com QUALQUER preço/serviceId inventado. A proteção
-- real está inteiramente em Node (calculateShipmentQuote, HTTP,
-- inevitavelmente fora do Postgres) — por isso esta função é
-- `service_role`-only (mesmo modelo de confiança de
-- private.store_shipping_credentials/etc., migration 087): só o próprio
-- servidor Node pode chamá-la, nunca o navegador, mesmo que tenha a
-- anon key pública. `features/shipping/melhor-envio-checkout.ts` é o
-- ÚNICO chamador previsto, sempre imediatamente após seu próprio
-- calculateShipmentQuote() na mesma requisição — nunca com um valor
-- vindo de fora dessa cadeia.
create function public.apply_melhor_envio_shipping_to_order(
  p_tenant_id uuid,
  p_order_id uuid,
  p_service_id text,
  p_service_name text,
  p_price numeric,
  p_estimated_days integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id and tenant_id = p_tenant_id;
  if v_order.id is null then
    raise exception 'order not found for this store' using errcode = 'P0002';
  end if;
  -- Mesmo guard de apply_shipping_to_order: frete só pode ser alterado
  -- enquanto o pedido ainda não avançou (nunca depois de pago).
  if v_order.status <> 'PENDING' then
    raise exception 'order can no longer be changed' using errcode = 'P0002';
  end if;

  -- Melhor Envio nunca é retirada na loja — sempre entrega no endereço
  -- do cliente, que precisa já estar congelado no pedido (mesmo
  -- princípio da versão pickup-aware de apply_shipping_to_order,
  -- migration 086, mas aqui é sempre obrigatório, nunca condicional).
  if v_order.shipping_address is null then
    raise exception 'order has no shipping address for this method' using errcode = 'P0002';
  end if;

  update public.orders
  set shipping_total = p_price,
      shipping_method = p_service_name,
      shipping_provider = 'melhor_envio',
      shipping_estimated_days = p_estimated_days,
      shipping_reference = p_service_id,
      -- discount_total continua 0 nesta etapa (mesmo motivo de
      -- apply_shipping_to_order) — orders_total_matches_components já
      -- garante consistência sem repetir a fórmula manualmente aqui.
      total = v_order.subtotal + p_price - v_order.discount_total
  where id = p_order_id and tenant_id = p_tenant_id;
end;
$$;

comment on function public.apply_melhor_envio_shipping_to_order(uuid, uuid, text, text, numeric, integer) is
  'Aplica ao pedido PENDING uma cotação Melhor Envio já revalidada via HTTP em Node (calculateShipmentQuote), na mesma requisição — nunca relê nada aqui porque não há tabela de preço para Melhor Envio; por isso service_role-only, nunca anon (diferente de apply_shipping_to_order).';

revoke execute on function public.apply_melhor_envio_shipping_to_order(uuid, uuid, text, text, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.apply_melhor_envio_shipping_to_order(uuid, uuid, text, text, numeric, integer) to service_role;
