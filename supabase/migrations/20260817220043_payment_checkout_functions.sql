-- Etapa 11 — funções de pagamento do checkout (anon, mesmo modelo de
-- create_order_from_cart/get_order_confirmation da Etapa 10) + a função
-- que o webhook usa para aplicar o resultado real (service_role-only,
-- prompt §14: "se service_role for necessário... webhook").
--
-- create_order_from_cart (Etapa 10) NÃO é alterada — o pedido continua
-- sendo criado exatamente pelo mesmo mecanismo (prompt §8: "não
-- duplicar a criação do pedido").
create function public.create_payment_for_order(p_tenant_id uuid, p_order_id uuid, p_provider text)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_row public.payments;
begin
  select * into v_order from public.orders where id = p_order_id and tenant_id = p_tenant_id;
  if v_order.id is null then
    raise exception 'order not found for this store' using errcode = 'P0002';
  end if;
  if v_order.payment_status = 'APPROVED' then
    raise exception 'order is already paid' using errcode = 'P0002';
  end if;

  -- Valor sempre lido de orders.total (já calculado pelo servidor na
  -- Etapa 10) — nunca um parâmetro vindo do cliente (prompt §12).
  insert into public.payments (tenant_id, order_id, provider, status, amount)
  values (p_tenant_id, p_order_id, p_provider, 'PENDING', v_order.total)
  on conflict (order_id)
  do update set provider = excluded.provider, status = 'PENDING', amount = excluded.amount, external_id = null, method = null, paid_at = null
  returning * into v_row;

  return v_row;
end;
$$;

create function public.attach_payment_preference(p_tenant_id uuid, p_order_id uuid, p_external_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
  set external_id = p_external_id
  where order_id = p_order_id and tenant_id = p_tenant_id;

  if not found then
    raise exception 'payment not found for this order' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.create_payment_for_order(uuid, uuid, text) from public, authenticated, service_role;
grant execute on function public.create_payment_for_order(uuid, uuid, text) to anon;
revoke execute on function public.attach_payment_preference(uuid, uuid, text) from public, authenticated, service_role;
grant execute on function public.attach_payment_preference(uuid, uuid, text) to anon;

-- Chamada só pelo webhook (service_role) — nunca pelo checkout/cliente.
-- Atualiza payments + só então orders.payment_status/orders.status,
-- atomicamente. Divergência de valor é ignorada silenciosamente (não
-- aplica a atualização) em vez de erro — o valor já foi conferido na
-- camada TS antes de chamar isto; esta checagem é só defesa em
-- profundidade, e um erro aqui faria o Mercado Pago re-tentar o webhook
-- indefinidamente sem nunca ter sucesso.
create function public.apply_payment_update(
  p_tenant_id uuid,
  p_order_id uuid,
  p_provider text,
  p_external_id text,
  p_status text,
  p_method text,
  p_amount numeric
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
    return; -- pedido não encontrado para este tenant — nada a aplicar, silenciosamente.
  end if;
  if abs(v_order.total - p_amount) > 0.01 then
    return; -- valor divergente — não aplica (prompt §17: "valor divergente").
  end if;

  update public.payments
  set external_id = p_external_id,
      status = p_status,
      method = p_method,
      paid_at = case when p_status = 'APPROVED' then now() else paid_at end
  where order_id = p_order_id and tenant_id = p_tenant_id and provider = p_provider;

  update public.orders
  set payment_status = p_status,
      status = case when p_status = 'APPROVED' and status = 'PENDING' then 'PAID' else status end
  where id = p_order_id and tenant_id = p_tenant_id;
end;
$$;

revoke execute on function public.apply_payment_update(uuid, uuid, text, text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.apply_payment_update(uuid, uuid, text, text, text, text, numeric) to service_role;
