-- Etapa 2A (expansão) — posse criptográfica do carrinho e checkout
-- atômico. Esta migration é deliberadamente compatível com a versão
-- anterior da aplicação: ela adiciona o novo caminho server-side, mas
-- ainda não remove os grants antigos. A revogação acontece na migration
-- 20260817220123, depois do deploy coordenado da aplicação.

alter table public.carts
  add column owner_token_hash text,
  add column checkout_order_id uuid unique references public.orders (id);

alter table public.carts
  add constraint carts_owner_token_hash_format_check
  check (owner_token_hash is null or owner_token_hash ~ '^[0-9a-f]{64}$');

comment on column public.carts.owner_token_hash is
  'SHA-256 hex de um segredo aleatório de 256 bits mantido somente no cookie HttpOnly do comprador. UUID do carrinho nunca é prova de posse.';
comment on column public.carts.checkout_order_id is
  'Pedido criado para este carrinho. Torna retries e submissões concorrentes idempotentes.';

create function private.protect_cart_security_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_token_hash is distinct from old.owner_token_hash then
    raise exception 'cart owner token cannot be changed' using errcode = '42501';
  end if;
  if old.checkout_order_id is not null
     and new.checkout_order_id is distinct from old.checkout_order_id then
    raise exception 'cart checkout order cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_cart_security_fields
before update on public.carts
for each row execute function private.protect_cart_security_fields();

-- Um único ponto transacional cria pedido, reserva estoque e aplica o
-- frete. Chamadas HTTP (ex.: Melhor Envio/Mercado Pago) acontecem antes
-- ou depois desta função, nunca dentro da transação PostgreSQL.
create function public.checkout_cart_secure(
  p_tenant_id uuid,
  p_cart_id uuid,
  p_owner_token_hash text,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping_address jsonb,
  p_order_source text,
  p_payment_channel text,
  p_requested_payment_method text,
  p_cash_change_for numeric,
  p_shipping_kind text,
  p_shipping_method_id uuid,
  p_expected_shipping_price numeric,
  p_me_service_id text,
  p_me_service_name text,
  p_me_price numeric,
  p_me_estimated_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_order_id uuid;
  v_order_id uuid;
  v_order_total numeric;
  v_shipping_required boolean;
begin
  if p_owner_token_hash is null
     or p_owner_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'cart ownership could not be verified' using errcode = '42501';
  end if;

  -- O lock serializa checkout concorrente do mesmo carrinho. O segredo
  -- bruto nunca chega ao banco: a comparação é somente entre hashes.
  select c.checkout_order_id
    into v_existing_order_id
  from public.carts c
  where c.id = p_cart_id
    and c.tenant_id = p_tenant_id
    and c.owner_token_hash = p_owner_token_hash
  for update;

  if not found then
    raise exception 'cart ownership could not be verified' using errcode = '42501';
  end if;

  if v_existing_order_id is not null then
    return jsonb_build_object('orderId', v_existing_order_id, 'created', false);
  end if;

  select coalesce(s.enabled, false)
    into v_shipping_required
  from public.shipping_settings s
  where s.tenant_id = p_tenant_id;
  v_shipping_required := coalesce(v_shipping_required, false);

  if p_shipping_kind not in ('none', 'method', 'melhor_envio') then
    raise exception 'invalid shipping selection' using errcode = 'P0001';
  end if;
  if p_shipping_kind = 'none' and v_shipping_required then
    raise exception 'shipping method is required' using errcode = 'P0001';
  end if;

  -- A função histórica continua sendo a fonte única para snapshots,
  -- preços, customers, estoque e itens. Ela deixa de ser pública na
  -- migration de lockdown e passa a ser um detalhe interno deste wrapper.
  v_order_id := public.create_order_from_cart(
    p_tenant_id,
    p_cart_id,
    p_customer_name,
    p_customer_email,
    p_customer_phone,
    p_shipping_address,
    p_order_source,
    p_payment_channel,
    p_requested_payment_method,
    p_cash_change_for
  );

  if p_shipping_kind = 'method' then
    if p_shipping_method_id is null or p_expected_shipping_price is null then
      raise exception 'invalid shipping selection' using errcode = 'P0001';
    end if;
    perform public.apply_shipping_to_order(
      p_tenant_id,
      v_order_id,
      p_shipping_method_id,
      p_expected_shipping_price
    );
  elsif p_shipping_kind = 'melhor_envio' then
    if p_me_service_id is null
       or p_me_service_name is null
       or p_me_price is null
       or p_me_price < 0 then
      raise exception 'invalid shipping selection' using errcode = 'P0001';
    end if;
    perform public.apply_melhor_envio_shipping_to_order(
      p_tenant_id,
      v_order_id,
      p_me_service_id,
      p_me_service_name,
      p_me_price,
      p_me_estimated_days
    );
  end if;

  select o.total into v_order_total
  from public.orders o
  where o.id = v_order_id and o.tenant_id = p_tenant_id;

  -- A função histórica valida troco contra o subtotal. Aqui a validação
  -- ocorre novamente contra o total final, já com frete, e qualquer
  -- falha reverte pedido, itens, estoque e limpeza do carrinho.
  if p_cash_change_for is not null and p_cash_change_for < v_order_total then
    raise exception 'cash change amount is less than the order total' using errcode = 'P0001';
  end if;

  update public.carts
  set checkout_order_id = v_order_id
  where id = p_cart_id and tenant_id = p_tenant_id;

  return jsonb_build_object('orderId', v_order_id, 'created', true);
end;
$$;

comment on function public.checkout_cart_secure(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, numeric,
  text, uuid, numeric, text, text, numeric, integer
) is
  'BFF checkout: valida posse por hash, serializa o carrinho, cria pedido/reserva estoque/aplica frete na mesma transação e devolve o mesmo pedido em retries.';

revoke execute on function public.checkout_cart_secure(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, numeric,
  text, uuid, numeric, text, text, numeric, integer
) from public, anon, authenticated;
grant execute on function public.checkout_cart_secure(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, numeric,
  text, uuid, numeric, text, text, numeric, integer
) to service_role;

-- Compatibilidade expand/deploy/contract: a nova aplicação passa a usar
-- service_role nestes caminhos antes de a migration de lockdown remover
-- os grants legados de anon. Conceder service_role aqui não amplia acesso
-- do navegador e permite publicar a aplicação com o banco apenas expandido.
-- A migration 20260817220123 continua sendo a única responsável por
-- revogar anon/authenticated/PUBLIC.
grant select, insert, update, delete on table public.carts to service_role;
grant select, insert, update, delete on table public.cart_items to service_role;
grant execute on function public.add_to_cart(uuid, uuid, uuid, integer, uuid)
  to service_role;
grant execute on function public.create_order_from_cart(
  uuid, uuid, text, text, text, jsonb, text, text, text, numeric
) to service_role;
grant execute on function public.apply_shipping_to_order(uuid, uuid, uuid, numeric)
  to service_role;
grant execute on function public.apply_melhor_envio_shipping_to_order(
  uuid, uuid, text, text, numeric, integer
) to service_role;
grant execute on function public.create_payment_for_order(uuid, uuid, text)
  to service_role;
grant execute on function public.attach_payment_preference(uuid, uuid, text)
  to service_role;
