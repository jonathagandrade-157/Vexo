-- D19.2.4.1 — Integração de customers ao checkout, dentro de
-- create_order_from_cart. Fundação (D19.2.3/20260817220112) já está em
-- produção; esta migration só adiciona a resolução/criação de customer
-- na MESMA transação do pedido, e passa a preencher orders.customer_id.
--
-- REGRA ABSOLUTA preservada: mesma assinatura de 10 parâmetros (mesmos
-- nomes/ordem/tipos), mesma SECURITY DEFINER, mesmo search_path = ''.
-- create_order_from_cart nunca aceita customer_id como parâmetro — é
-- resolvido inteiramente dentro da função, nunca influenciável pelo
-- chamador (mesmo princípio de "preço sempre recalculado no servidor,
-- nunca aceito do cliente", agora aplicado à identidade do cliente).
--
-- ACHADO DE IMPLEMENTAÇÃO (não uma mudança de arquitetura aprovada
-- anteriormente — documentado aqui, não escondido): checkoutSchema
-- (features/checkout/schema.ts) normaliza e-mail (trim+lowercase) mas
-- NUNCA converte telefone para E.164 — só valida "≥10 dígitos" livres de
-- formatação. `customers.phone` exige E.164 estrito
-- (customers_phone_e164_check, 20260817220112). Sem tratamento, um
-- telefone comum do checkout (ex.: "11912345678", o próprio valor padrão
-- usado em tests/integration/checkout.test.ts) quebraria a criação do
-- customer com um check_violation — e, por estar na mesma transação,
-- derrubaria o pedido inteiro, uma regressão real no caminho crítico do
-- checkout. Resolução adotada (mínima, conservadora, sem inventar uma
-- biblioteca de normalização de telefone dentro do Postgres — a mesma
-- restrição já aplicada à própria migration da fundação):
-- v_valid_phone só é usado quando já bate no formato E.164 exigido;
-- caso contrário, o customer é resolvido/criado com phone = NULL — o
-- telefone nunca bloqueia a criação do customer nem do pedido. O
-- snapshot orders.customer_phone continua gravando o valor exatamente
-- como o cliente digitou, sem nenhuma alteração — só o campo phone da
-- entidade customers (opcional, auxiliar) fica sem esse dado até uma
-- normalização real de telefone ser implementada na aplicação (fora do
-- escopo desta etapa). E-mail é normalizado (lower+trim) aqui de novo,
-- defensivamente — create_order_from_cart é anon-callable diretamente
-- via REST (gap já conhecido e aceito desde D19.1.3.1), então não pode
-- depender só da normalização do Zod do lado da aplicação.
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
  v_new_stock integer;
  v_stock_reserved boolean;
  v_customer_id uuid;
  v_normalized_email text;
  v_valid_phone text;
begin
  if p_order_source not in ('vexo_checkout', 'whatsapp') then
    raise exception 'invalid order source' using errcode = 'P0001';
  end if;
  if p_payment_channel not in ('gateway', 'external') then
    raise exception 'invalid payment channel' using errcode = 'P0001';
  end if;
  if (p_payment_channel = 'external') <> (p_requested_payment_method is not null) then
    raise exception 'requested payment method is required for external payment channel, and only for it' using errcode = 'P0001';
  end if;
  if p_requested_payment_method is not null and p_requested_payment_method not in ('pix', 'cash', 'card') then
    raise exception 'invalid requested payment method' using errcode = 'P0001';
  end if;
  if p_cash_change_for is not null and p_requested_payment_method <> 'cash' then
    raise exception 'cash_change_for only applies to cash payment preference' using errcode = 'P0001';
  end if;

  v_payment_status := case when p_payment_channel = 'external' then 'EXTERNAL' else 'PENDING' end;

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

  -- D19.2.4.1 — resolução/criação de customer. Ordem de locks fixa em
  -- TODA transação (cart → customer → product_inventory, na ordem
  -- ascendente já garantida pelo loop abaixo): resolve exatamente UMA
  -- linha de customers por checkout (nunca múltiplas), então não
  -- introduz a classe de deadlock que exigiu ORDER BY em
  -- product_inventory (D19.1.3.1/D19.1.3.3) — um UPDATE/INSERT de uma
  -- única linha nunca participa de um ciclo de lock, só bloqueia até a
  -- transação concorrente liberar. INSERT ... ON CONFLICT ... DO UPDATE
  -- é o mesmo padrão atômico já usado e comprovado neste projeto
  -- (public.add_to_cart, Etapa 9, UNIQUE(cart_id, product_id)) — nunca
  -- um SELECT seguido de INSERT separado, que teria uma janela de corrida
  -- real sob concorrência.
  v_normalized_email := nullif(lower(trim(p_customer_email)), '');
  v_valid_phone := case
    when trim(p_customer_phone) ~ '^\+[1-9][0-9]{6,14}$' then trim(p_customer_phone)
    else null
  end;

  if v_normalized_email is not null then
    -- Regra de matching por e-mail (D19.2.2/D19.2.4.1): busca/cria só por
    -- (tenant_id, email) — nunca considera telefone quando e-mail está
    -- presente, mesmo que o telefone coincida com o de outro customer
    -- (número reciclado, aparelho compartilhado — Caso C/G da revisão).
    -- name/phone são atualizados para o valor mais recente informado
    -- (nunca o nome/telefone de um pedido antigo "trava" o cadastro);
    -- phone só é sobrescrito quando o NOVO valor é válido — nunca apaga
    -- um telefone já conhecido só porque este pedido não trouxe um
    -- telefone normalizável.
    insert into public.customers (tenant_id, name, email, phone)
    values (p_tenant_id, p_customer_name, v_normalized_email, v_valid_phone)
    on conflict (tenant_id, email) do update
    set name = excluded.name,
        phone = coalesce(excluded.phone, public.customers.phone),
        updated_at = now()
    returning id into v_customer_id;
  elsif v_valid_phone is not null then
    -- Sem e-mail, com telefone válido: busca/cria só entre customers SEM
    -- e-mail (o índice único parcial customers_tenant_phone_unique_no_email,
    -- D19.2.2 H1) — nunca encontra nem colide com um customer que TEM
    -- e-mail, mesmo compartilhando o mesmo telefone.
    insert into public.customers (tenant_id, name, phone)
    values (p_tenant_id, p_customer_name, v_valid_phone)
    on conflict (tenant_id, phone) where email is null do update
    set name = excluded.name,
        updated_at = now()
    returning id into v_customer_id;
  else
    -- Nem e-mail nem telefone utilizável: nenhuma chave de matching
    -- possível — sempre cria um customer novo (D19.2.4 §4/§5), nunca
    -- deduplicado por nome.
    insert into public.customers (tenant_id, name)
    values (p_tenant_id, p_customer_name)
    returning id into v_customer_id;
  end if;

  v_order_number := 'PED' || lpad(nextval('public.orders_order_number_seq')::text, 6, '0');

  insert into public.orders (
    tenant_id, order_number, status, customer_name, customer_email, customer_phone,
    shipping_address, subtotal, discount_total, shipping_total, total,
    order_source, payment_channel, payment_status, requested_payment_method, cash_change_for,
    customer_id
  ) values (
    p_tenant_id, v_order_number, 'PENDING', p_customer_name, p_customer_email, p_customer_phone,
    p_shipping_address, 0, 0, 0, 0,
    p_order_source, p_payment_channel, v_payment_status, p_requested_payment_method, p_cash_change_for,
    v_customer_id
  )
  returning id into v_order_id;

  -- M1 — `order by ci.product_id`: garante que TODA transação concorrente
  -- adquire os locks de product_inventory na mesma ordem canônica
  -- (crescente por product_id), independentemente da ordem em que cada
  -- cliente montou o próprio carrinho. Duas transações que nunca disputam
  -- os locks em ordem cruzada nunca deadlockam entre si (regra clássica de
  -- prevenção de deadlock: ordem total consistente de aquisição de locks).
  for v_item in
    select ci.product_id, ci.quantity, p.name, p.slug, p.price, p.promotional_price, p.status,
           p.tenant_id as product_tenant_id
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    where ci.cart_id = p_cart_id and ci.tenant_id = p_tenant_id
    order by ci.product_id
  loop
    if v_item.product_tenant_id <> p_tenant_id or v_item.status <> 'active' then
      raise exception 'product % is no longer available', v_item.name using errcode = 'P0001';
    end if;

    -- H1/D19.1.1 §6/§8 — decremento atômico de estoque. Ausência de linha
    -- em product_inventory = "estoque não controlado": a venda segue sem
    -- checagem, e stock_reserved permanece false para este item (nada a
    -- restaurar se este pedido for cancelado depois).
    v_stock_reserved := false;
    if exists (
      select 1 from public.product_inventory
      where product_id = v_item.product_id and tenant_id = p_tenant_id
    ) then
      update public.product_inventory
      set stock_quantity = stock_quantity - v_item.quantity,
          updated_at = now()
      where product_id = v_item.product_id
        and tenant_id = p_tenant_id
        and stock_quantity >= v_item.quantity
      returning stock_quantity into v_new_stock;

      if not found then
        raise exception 'insufficient stock for product %', v_item.name using errcode = 'P0001';
      end if;
      v_stock_reserved := true;
    end if;

    insert into public.order_items (
      order_id, tenant_id, product_id, product_name, product_slug, quantity, unit_price, subtotal, stock_reserved
    ) values (
      v_order_id, p_tenant_id, v_item.product_id, v_item.name, v_item.slug, v_item.quantity,
      coalesce(v_item.promotional_price, v_item.price),
      coalesce(v_item.promotional_price, v_item.price) * v_item.quantity,
      v_stock_reserved
    );

    v_subtotal := v_subtotal + coalesce(v_item.promotional_price, v_item.price) * v_item.quantity;
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count = 0 then
    raise exception 'cart is empty' using errcode = 'P0002';
  end if;

  if p_cash_change_for is not null and p_cash_change_for < v_subtotal then
    raise exception 'cash change amount is less than the order subtotal' using errcode = 'P0001';
  end if;

  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;

  delete from public.cart_items where cart_id = p_cart_id and tenant_id = p_tenant_id;

  return v_order_id;
end;
$$;

comment on function public.create_order_from_cart(uuid, uuid, text, text, text, jsonb, text, text, text, numeric) is
  'Cria pedido a partir do carrinho, atomicamente (transação única) — preço/total sempre recalculados no servidor, nunca aceitos do cliente. Lock do carrinho (for update) é a estratégia anti-duplicidade. Fase D2-B: p_order_source/p_payment_channel/p_requested_payment_method/p_cash_change_for são parâmetros opcionais (default vexo_checkout/gateway/null/null) sempre fixados pela Action chamadora, nunca por formData do cliente. D19.1.2: decrementa product_inventory atomicamente no mesmo loop quando o produto tem controle de estoque definido (ausência de linha = sem checagem, comportamento legado preservado). D19.1.3.1: loop em ordem determinística por product_id (previne deadlock entre checkouts concorrentes) e grava order_items.stock_reserved (fonte de verdade para a restauração de estoque em update_order_status). D19.2.4.1: resolve/cria customers.id e grava em orders.customer_id, na mesma transação, antes do INSERT de orders — nunca um parâmetro aceito do chamador (resolvido inteiramente aqui dentro). Matching por e-mail normalizado (lower+trim) quando presente; por telefone (E.164, só entre customers sem e-mail) quando e-mail está ausente; customer novo sem matching quando nenhum dos dois está disponível. customer_name/customer_email/customer_phone em orders continuam sendo o snapshot histórico do pedido, nunca substituídos.';
