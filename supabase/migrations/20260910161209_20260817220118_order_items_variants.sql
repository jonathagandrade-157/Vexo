-- D20.5 — Checkout com variantes: order_items ganha snapshot de variante
-- (variant_id, variant_sku, variant_label, variant_options) e
-- create_order_from_cart/update_order_status/get_order_confirmation
-- passam a ler/gravar/expor esses campos. Migration aditiva: nenhuma
-- linha existente é alterada, nenhum backfill, produto simples
-- (cart_items.variant_id IS NULL) preserva 100% o comportamento de antes
-- em cada um dos três pontos. Nenhuma das três funções muda de
-- assinatura — CREATE OR REPLACE nas três, nenhum DROP FUNCTION.
--
-- Corrige também, nesta mesma migration, um bug crítico pré-existente
-- (achado na auditoria D20.5 Fase 1, §B.1): create_order_from_cart
-- ignorava cart_items.variant_id por completo — sempre cobrava o preço
-- do produto-pai e, pior, o UPDATE de estoque não filtrava por
-- variant_id, podendo decrementar TODAS as linhas de product_inventory
-- de um produto (uma por variante) numa única compra de 1 variante. O
-- WHERE do UPDATE (e do EXISTS que o precede) agora sempre inclui
-- `variant_id is not distinct from ci.variant_id` — nunca mais um UPDATE
-- set-based que casa com mais de uma linha de estoque por engano.

alter table public.order_items
  add column variant_id uuid references public.product_variants (id) on delete set null,
  add column variant_sku text,
  add column variant_label text,
  add column variant_options jsonb;

comment on column public.order_items.variant_id is
  'D20.5 — NULL para produto simples (comportamento anterior preservado integralmente). on delete set null (nunca cascade): o pedido é histórico e precisa sobreviver à exclusão da variante depois — mesmo motivo de product_id já ser ON DELETE SET NULL desde 20260817220033. Quando variant_id é NULL mas variant_label/variant_options estão preenchidos, significa que este item ERA de uma variante que foi excluída depois da compra (nunca confundir com "sempre foi produto simples" — ver private/public.update_order_status abaixo, que depende exatamente dessa distinção para decidir se restaura estoque).';
comment on column public.order_items.variant_sku is
  'D20.5 — snapshot de product_variants.sku no momento da compra; pode ser NULL mesmo com variant_id preenchido (sku é opcional em product_variants desde D20.2).';
comment on column public.order_items.variant_label is
  'D20.5 — rótulo de exibição montado no momento da compra a partir dos valores das opções, na ordem de product_options.position (ex.: "Preto / M") — nunca reconstruído a partir do catálogo atual, sobrevive a mudança/exclusão de opções/valores/variante depois.';
comment on column public.order_items.variant_options is
  'D20.5 — snapshot estruturado dos pares opção/valor da variante comprada, ex.: [{"option":"Cor","value":"Preto"},{"option":"Tamanho","value":"M"}], na ordem de product_options.position. Preserva a configuração histórica mesmo que product_options/product_option_values/product_variants mudem ou sejam excluídos depois.';

-- ---------------------------------------------------------------------
-- create_order_from_cart — mesma assinatura de 10 parâmetros de sempre.
-- ---------------------------------------------------------------------
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
  v_unit_price numeric(10, 2);
  v_variant_label text;
  v_variant_options jsonb;
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

  -- D19.2.4.1 — resolução/criação de customer (inalterado por D20.5).
  -- Ordem de locks fixa em TODA transação (cart → customer →
  -- product_inventory, na ordem ascendente já garantida pelo loop
  -- abaixo): resolve exatamente UMA linha de customers por checkout
  -- (nunca múltiplas), então não introduz a classe de deadlock que
  -- exigiu ORDER BY em product_inventory (D19.1.3.1/D19.1.3.3) — um
  -- UPDATE/INSERT de uma única linha nunca participa de um ciclo de
  -- lock, só bloqueia até a transação concorrente liberar. INSERT ... ON
  -- CONFLICT ... DO UPDATE é o mesmo padrão atômico já usado e
  -- comprovado neste projeto (public.add_to_cart, Etapa 9,
  -- UNIQUE(cart_id, product_id)) — nunca um SELECT seguido de INSERT
  -- separado, que teria uma janela de corrida real sob concorrência.
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

  -- D20.5 — o cursor agora lê ci.variant_id e faz LEFT JOIN em
  -- product_variants (nunca INNER: precisa distinguir "sem variante" de
  -- "variante inexistente/de outro tenant ou produto", tratados abaixo,
  -- de "variante existe mas está inativa"). `order by coalesce(ci.variant_id,
  -- ci.product_id)` estende a ordem determinística de lock (M1,
  -- 20260817220110/111) para cobrir as duas classes de linha de
  -- product_inventory (por produto OU por variante) com a MESMA técnica
  -- já comprovada (3/3 e 0/5 deadlocks nas respectivas suítes) — nenhuma
  -- técnica nova.
  for v_item in
    select
      ci.product_id, ci.variant_id, ci.quantity,
      p.name, p.slug, p.price as product_price, p.promotional_price as product_promotional_price,
      p.status, p.tenant_id as product_tenant_id,
      v.id as variant_row_id, v.price as variant_price, v.promotional_price as variant_promotional_price,
      v.is_active as variant_is_active, v.tenant_id as variant_tenant_id, v.product_id as variant_product_id,
      v.sku as variant_sku
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    left join public.product_variants v on v.id = ci.variant_id
    where ci.cart_id = p_cart_id and ci.tenant_id = p_tenant_id
    order by coalesce(ci.variant_id, ci.product_id)
  loop
    if v_item.product_tenant_id <> p_tenant_id or v_item.status <> 'active' then
      raise exception 'product % is no longer available', v_item.name using errcode = 'P0001';
    end if;

    v_variant_label := null;
    v_variant_options := null;
    v_unit_price := coalesce(v_item.product_promotional_price, v_item.product_price);

    -- D20.5 — revalidação completa no momento do pedido (defesa em
    -- profundidade contra a janela entre add-to-cart e checkout: a
    -- variante pode ter sido desativada, ou o registro em si excluído,
    -- depois de adicionada ao carrinho — cart_items.variant_id é ON
    -- DELETE CASCADE, então nesse caso o próprio cart_item já teria
    -- desaparecido antes de chegar aqui; ainda assim a checagem
    -- estrutural abaixo é mantida como defesa em profundidade, nunca
    -- assumindo que a validação de escrita de cart_items é a única
    -- linha de defesa): existe, mesmo tenant, mesmo produto, ativa.
    -- Qualquer falha rejeita O PEDIDO INTEIRO (decisão explícita D20.5
    -- Fase 2 #2) — nunca remove só o item silenciosamente.
    if v_item.variant_id is not null then
      if v_item.variant_row_id is null
        or v_item.variant_tenant_id <> p_tenant_id
        or v_item.variant_product_id <> v_item.product_id
      then
        raise exception 'the selected option for product % is no longer available', v_item.name using errcode = 'P0001';
      end if;
      if not v_item.variant_is_active then
        raise exception 'the selected option for product % is no longer available', v_item.name using errcode = 'P0001';
      end if;

      -- D20.5 — o preço da variante SEMPRE prevalece sobre o do
      -- produto-pai quando há variante (nunca o contrário).
      v_unit_price := coalesce(v_item.variant_promotional_price, v_item.variant_price);

      -- Snapshot da configuração comprada, na ordem de exibição das
      -- opções (product_options.position) — cada elemento pertence a uma
      -- product_option distinta por construção (trigger
      -- validate_product_variant_option_values, D20.2), então não há
      -- ambiguidade de ordenação por valor dentro de uma mesma opção.
      select
        jsonb_agg(jsonb_build_object('option', po.name, 'value', pov.value) order by po.position),
        string_agg(pov.value, ' / ' order by po.position)
      into v_variant_options, v_variant_label
      from public.product_variant_options pvo
      join public.product_option_values pov on pov.id = pvo.product_option_value_id
      join public.product_options po on po.id = pov.product_option_id
      where pvo.variant_id = v_item.variant_id;
    else
      -- D20.5 (correção MEDIUM-1 da revisão independente §C) — o item não
      -- tem variant_id, mas o CATÁLOGO pode ter mudado depois que ele foi
      -- adicionado ao carrinho: o produto pode ter passado a ter
      -- variantes cadastradas DEPOIS que este cart_item (de antes disso)
      -- foi criado como "simples". O trigger de cart_items
      -- (prevent_cross_tenant_cart_item, D20.4) só barra isso no INSERT —
      -- nunca revalida um item já existente. Sem esta checagem, o
      -- checkout venderia ao preço-base do produto um item que hoje
      -- deveria exigir escolha de variante. Mesma decisão de sempre:
      -- rejeita O PEDIDO INTEIRO (nunca remove só o item), antes de
      -- qualquer decremento de estoque ou insert em order_items desta
      -- iteração do loop.
      if exists (
        select 1 from public.product_variants pv
        where pv.product_id = v_item.product_id and pv.tenant_id = p_tenant_id
      ) then
        raise exception 'this product requires selecting a variant' using errcode = 'P0001';
      end if;
    end if;

    -- H1/D19.1.1 §6/§8 — decremento atômico de estoque. Ausência de linha
    -- em product_inventory para este (product_id, variant_id) = "estoque
    -- não controlado": a venda segue sem checagem, e stock_reserved
    -- permanece false para este item (nada a restaurar se este pedido
    -- for cancelado depois).
    --
    -- D20.5 (correção do bug crítico §B.1 da auditoria) — o WHERE agora
    -- SEMPRE inclui `variant_id is not distinct from v_item.variant_id`
    -- (nunca só product_id): sem isso, um produto com estoque por
    -- variante (várias linhas de product_inventory, uma por variante)
    -- teria TODAS as suas linhas decrementadas por uma compra de UMA
    -- única variante. `is not distinct from` (em vez de `=`) é
    -- obrigatório aqui porque variant_id pode ser NULL (produto simples)
    -- e `NULL = NULL` nunca é true em SQL.
    v_stock_reserved := false;
    if exists (
      select 1 from public.product_inventory
      where product_id = v_item.product_id
        and tenant_id = p_tenant_id
        and variant_id is not distinct from v_item.variant_id
    ) then
      update public.product_inventory
      set stock_quantity = stock_quantity - v_item.quantity,
          updated_at = now()
      where product_id = v_item.product_id
        and tenant_id = p_tenant_id
        and variant_id is not distinct from v_item.variant_id
        and stock_quantity >= v_item.quantity
      returning stock_quantity into v_new_stock;

      if not found then
        raise exception 'insufficient stock for product %', v_item.name using errcode = 'P0001';
      end if;
      v_stock_reserved := true;
    end if;

    insert into public.order_items (
      order_id, tenant_id, product_id, product_name, product_slug, quantity, unit_price, subtotal, stock_reserved,
      variant_id, variant_sku, variant_label, variant_options
    ) values (
      v_order_id, p_tenant_id, v_item.product_id, v_item.name, v_item.slug, v_item.quantity,
      v_unit_price, v_unit_price * v_item.quantity, v_stock_reserved,
      v_item.variant_id, v_item.variant_sku, v_variant_label, v_variant_options
    );

    v_subtotal := v_subtotal + v_unit_price * v_item.quantity;
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
  'Único caminho de criação de pedido a partir de um carrinho — anon, security definer. D20.5: lê cart_items.variant_id (LEFT JOIN product_variants), revalida a variante por completo no momento do pedido (existe/mesmo tenant/mesmo produto/ativa — rejeita o PEDIDO INTEIRO se qualquer checagem falhar), usa SEMPRE o preço da variante quando há variante (nunca o do produto-pai), grava snapshot de variant_id/variant_sku/variant_label/variant_options em order_items, e decrementa product_inventory escopado também por variant_id (`is not distinct from`) — corrige o bug pré-D20.5 em que o decremento podia atingir todas as linhas de estoque de um produto com variantes numa única compra. Correção MEDIUM-1 (revisão independente Fase 3): quando variant_id é NULL, revalida também que o produto ainda NÃO tem nenhuma variante cadastrada — um item "simples" adicionado antes de o produto ganhar variantes é rejeitado no checkout, nunca vendido silenciosamente ao preço-base.';

-- ---------------------------------------------------------------------
-- update_order_status — mesma assinatura de 4 parâmetros de sempre.
-- ---------------------------------------------------------------------
create or replace function public.update_order_status(
  p_tenant_id uuid,
  p_order_id uuid,
  p_new_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_allowed boolean;
  v_restore_item record;
begin
  select private.has_permission(p_tenant_id, 'orders.update') into v_allowed;
  if not (coalesce(v_allowed, false) or private.is_platform_admin()) then
    raise exception 'insufficient permission to update this order' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id and tenant_id = p_tenant_id;
  if v_order.id is null then
    raise exception 'order not found for this store' using errcode = 'P0002';
  end if;

  if not (
    (v_order.status = 'PENDING' and p_new_status = 'CANCELLED')
    or (v_order.status = 'PAID' and p_new_status in ('PREPARING', 'CANCELLED'))
    or (v_order.status = 'PREPARING' and p_new_status in ('SHIPPED', 'CANCELLED'))
    or (v_order.status = 'SHIPPED' and p_new_status = 'DELIVERED')
  ) then
    raise exception 'invalid order status transition from % to %', v_order.status, p_new_status using errcode = 'P0001';
  end if;

  update public.orders
  set status = p_new_status,
      internal_note = p_note
  where id = p_order_id and tenant_id = p_tenant_id and status = v_order.status;

  if not found then
    raise exception 'order status changed concurrently, please retry' using errcode = '40001';
  end if;

  -- D19.1.3.3 — restaura estoque reservado em ordem canônica crescente
  -- (mesma ordem do loop de decremento em create_order_from_cart) —
  -- previne deadlock entre cancelamentos concorrentes de pedidos
  -- diferentes que compartilham produtos/variantes.
  --
  -- D20.5 — a restauração agora é escopada também por variant_id (mesma
  -- técnica `is not distinct from` do decremento), e o filtro do cursor
  -- ganha `(oi.variant_id is not null or oi.variant_label is null)` para
  -- distinguir os dois motivos possíveis de variant_id estar NULL aqui:
  --   (a) o item sempre foi de produto simples (variant_label também
  --       NULL) — inclui normalmente, restaura a linha "produto simples"
  --       (variant_id is null na linha de product_inventory);
  --   (b) o item ERA de uma variante que foi excluída depois da compra
  --       (variant_label preenchido, variant_id virou NULL via ON DELETE
  --       SET NULL) — a própria linha de product_inventory daquela
  --       variante também foi excluída em cascata (product_inventory.
  --       variant_id é ON DELETE CASCADE desde D20.3), então não há mais
  --       nada para restaurar; incluir esse item incorretamente tentaria
  --       somar estoque na linha do produto SIMPLES (se existir uma),
  --       o que seria errado — comportamento conservador preservado,
  --       mesmo espírito do guard `oi.product_id is not null` já
  --       existente para produto excluído.
  -- `order by coalesce(variant_id, product_id)` estende a mesma ordem
  -- determinística de lock para as duas classes de linha.
  if p_new_status = 'CANCELLED' then
    for v_restore_item in
      select oi.product_id, oi.variant_id, oi.quantity
      from public.order_items oi
      where oi.order_id = p_order_id
        and oi.tenant_id = p_tenant_id
        and oi.stock_reserved
        and oi.product_id is not null
        and (oi.variant_id is not null or oi.variant_label is null)
      order by coalesce(oi.variant_id, oi.product_id)
    loop
      update public.product_inventory
      set stock_quantity = stock_quantity + v_restore_item.quantity,
          updated_at = now()
      where product_id = v_restore_item.product_id
        and tenant_id = p_tenant_id
        and variant_id is not distinct from v_restore_item.variant_id;
    end loop;
  end if;
end;
$$;

comment on function public.update_order_status(uuid, uuid, text, text) is
  'Único caminho para avançar orders.status depois da criação do pedido — valida a transição numa máquina de estados exaustiva no servidor, nunca confia num status vindo do cliente. Nunca altera payment_status nem dispara nenhuma operação financeira externa. Quando a transição resulta em CANCELLED, restaura atomicamente (mesma transação) o estoque de todo order_item com stock_reserved=true, escopado por variant_id (D20.5) — idempotente por construção (CANCELLED é terminal na máquina de estados; o compare-and-swap já existente garante que a transição só acontece uma vez, mesmo sob concorrência/retry). Restauração via loop FOR...IN ORDER BY coalesce(variant_id, product_id) — mesma ordem canônica do decremento em create_order_from_cart, elimina deadlock (40P01) entre cancelamentos concorrentes de pedidos diferentes compartilhando produtos/variantes.';

-- ---------------------------------------------------------------------
-- get_order_confirmation — mesma assinatura de 2 parâmetros de sempre.
-- ---------------------------------------------------------------------
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

  -- D20.5 — expõe também o snapshot de variante (variantId/variantSku/
  -- variantLabel/variantOptions), sempre a partir de order_items (nunca
  -- reconsultando product_variants/product_options — o pedido já é
  -- histórico).
  select coalesce(jsonb_agg(jsonb_build_object(
    'productName', oi.product_name,
    'productSlug', oi.product_slug,
    'quantity', oi.quantity,
    'unitPrice', oi.unit_price,
    'subtotal', oi.subtotal,
    'variantId', oi.variant_id,
    'variantSku', oi.variant_sku,
    'variantLabel', oi.variant_label,
    'variantOptions', oi.variant_options
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
$$;

comment on function public.get_order_confirmation(uuid, uuid) is
  'Confirmação pública do pedido (anon, token de posse = order_id) — projeta só o necessário para a tela de confirmação, nunca internal_note nem dados administrativos. D20.5: items[] passa a incluir variantId/variantSku/variantLabel/variantOptions, sempre lidos do snapshot em order_items.';
