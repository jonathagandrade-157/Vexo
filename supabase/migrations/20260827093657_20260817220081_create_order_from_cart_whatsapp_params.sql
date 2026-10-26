-- Fase D2-B — estende create_order_from_cart (Etapa 10, migration
-- 20260817220036) com parâmetros opcionais no FINAL da lista, com
-- default idêntico ao comportamento de sempre — preserva integralmente:
-- lock do carrinho (FOR UPDATE, anti-duplo-clique/duplicidade), recálculo
-- de preço 100% ao vivo de products (incluindo promotional_price),
-- validação de tenant/status do produto, criação transacional de
-- orders+order_items, limpeza do carrinho. Nenhuma dessas garantias é
-- tocada — só o que é gravado em order_source/payment_channel/
-- payment_status/requested_payment_method/cash_change_for muda, e só
-- quando o chamador passa valores diferentes do default.
--
-- Estratégia escolhida na auditoria D2-A (§4, opção A): parâmetros
-- adicionados no final com DEFAULT, nunca uma segunda função duplicando a
-- lógica — quem já chama com os 6 parâmetros originais (features/checkout
-- /actions.ts::createOrderAction, e todo teste de integração existente em
-- tests/integration/checkout.test.ts) continua funcionando exatamente
-- como antes, sem precisar mudar uma linha.
--
-- `create or replace function` sozinho NÃO substitui a função de 6
-- parâmetros aqui — para Postgres, uma lista de tipos de parâmetro
-- diferente é uma função DIFERENTE, então as duas coexistiriam como
-- overloads, e uma chamada com exatamente 6 argumentos passaria a ser
-- ambígua entre elas ("is not unique"). O DROP explícito abaixo é o que
-- garante que só a versão mais nova existe depois desta migration —
-- continua sendo "a mesma função", só que agora com mais parâmetros
-- opcionais, nunca uma segunda.
drop function if exists public.create_order_from_cart(uuid, uuid, text, text, text, jsonb);
drop function if exists public.create_order_from_cart(uuid, uuid, text, text, text, jsonb, text, text, text);

create or replace function public.create_order_from_cart(
  p_tenant_id uuid,
  p_cart_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping_address jsonb,
  p_order_source text default 'vexo_checkout',
  p_payment_channel text default 'gateway',
  p_requested_payment_method text default null,
  p_cash_change_for numeric default null
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
  v_payment_status text;
begin
  -- Falha rápido, antes de travar o carrinho, se o próprio código
  -- chamador (nunca o cliente — estes parâmetros não vêm de formData, ver
  -- features/checkout/actions.ts e whatsapp-actions.ts) passar um valor
  -- fora do esperado. As CHECKs da tabela (migrations 20260817220079/80)
  -- já garantiriam isso no INSERT, mas falhar aqui evita travar/destravar
  -- o carrinho à toa para uma chamada estruturalmente inválida.
  if p_order_source not in ('vexo_checkout', 'whatsapp') then
    raise exception 'invalid order source' using errcode = 'P0001';
  end if;
  if p_payment_channel not in ('gateway', 'external') then
    raise exception 'invalid payment channel' using errcode = 'P0001';
  end if;
  -- Seleção de forma de pagamento é OBRIGATÓRIA no caminho external
  -- (Fase D2-B, revisão final) e proibida no caminho gateway — mesma
  -- equivalência da CHECK orders_requested_payment_method_channel_check,
  -- checada aqui também para nunca depender só do INSERT falhar tarde.
  if (p_payment_channel = 'external') <> (p_requested_payment_method is not null) then
    raise exception 'requested payment method is required for external payment channel, and only for it' using errcode = 'P0001';
  end if;
  if p_requested_payment_method is not null and p_requested_payment_method not in ('pix', 'cash', 'card') then
    raise exception 'invalid requested payment method' using errcode = 'P0001';
  end if;
  if p_cash_change_for is not null and p_requested_payment_method <> 'cash' then
    raise exception 'cash_change_for only applies to cash payment preference' using errcode = 'P0001';
  end if;

  -- external → EXTERNAL, sempre; gateway → PENDING, o mesmo default de
  -- sempre (Etapa 10/11) — nenhuma mudança de comportamento para o
  -- caminho padrão.
  v_payment_status := case when p_payment_channel = 'external' then 'EXTERNAL' else 'PENDING' end;

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
    shipping_address, subtotal, discount_total, shipping_total, total,
    order_source, payment_channel, payment_status, requested_payment_method, cash_change_for
  ) values (
    p_tenant_id, v_order_number, 'PENDING', p_customer_name, p_customer_email, p_customer_phone,
    p_shipping_address, 0, 0, 0, 0,
    p_order_source, p_payment_channel, v_payment_status, p_requested_payment_method, p_cash_change_for
  )
  returning id into v_order_id;

  -- Preço sempre lido AO VIVO de products aqui dentro — nunca de
  -- cart_items (que nem armazena preço, Etapa 9) nem de qualquer valor
  -- vindo do cliente. Qualquer produto excluído/de outro
  -- tenant/inativo aborta a função inteira (nenhuma escrita parcial —
  -- é uma única transação Postgres). Idêntico ao original, intocado.
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

  -- Troco tem que cobrir pelo menos o subtotal já conhecido aqui (checagem
  -- fraca, defesa em profundidade) — a checagem forte, contra o total
  -- final COM frete, é feita no servidor (TypeScript) ANTES de chamar
  -- esta função (features/checkout/whatsapp-actions.ts), usando o mesmo
  -- subtotal computado pelo carrinho (features/cart/data.ts) + o preço de
  -- frete já revalidado fresco. Nunca confia no p_cash_change_for como
  -- suficiente por si só além disto.
  if p_cash_change_for is not null and p_cash_change_for < v_subtotal then
    raise exception 'cash change amount is less than the order subtotal' using errcode = 'P0001';
  end if;

  -- shipping_total/discount_total permanecem 0 (checks da tabela já
  -- impediriam outro valor de qualquer forma).
  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;

  delete from public.cart_items where cart_id = p_cart_id and tenant_id = p_tenant_id;

  return v_order_id;
end;
$$;

comment on function public.create_order_from_cart(uuid, uuid, text, text, text, jsonb, text, text, text, numeric) is
  'Cria pedido a partir do carrinho, atomicamente (transação única) — preço/total sempre recalculados no servidor, nunca aceitos do cliente. Lock do carrinho (for update) é a estratégia anti-duplicidade. Fase D2-B: p_order_source/p_payment_channel/p_requested_payment_method/p_cash_change_for são parâmetros opcionais (default vexo_checkout/gateway/null/null) sempre fixados pela Action chamadora, nunca por formData do cliente.';

revoke execute on function public.create_order_from_cart(uuid, uuid, text, text, text, jsonb, text, text, text, numeric)
  from public, authenticated, service_role;
grant execute on function public.create_order_from_cart(uuid, uuid, text, text, text, jsonb, text, text, text, numeric) to anon;
