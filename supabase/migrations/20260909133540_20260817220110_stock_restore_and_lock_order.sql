-- D19.1.3.1 — corrige os 2 achados da Security Review D19.1.3 (H1/M1)
-- sobre o controle de estoque (D19.1.2, migration 20260817220109).
--
-- H1 (HIGH) — estoque decrementado por create_order_from_cart nunca era
-- restaurado ao cancelar o pedido, permitindo consumo permanente e
-- irreversível de estoque real sem pagamento. Corrigido restaurando
-- estoque dentro de update_order_status quando a transição resulta em
-- CANCELLED — nunca um trigger novo/paralelo, a mesma função que já é o
-- único caminho de escrita de orders.status depois da criação.
--
-- M1 (MEDIUM) — o loop de create_order_from_cart não tinha ORDER BY
-- determinístico, permitindo lock de product_inventory em ordem cruzada
-- entre checkouts concorrentes com produtos em comum (risco de deadlock
-- 40P01). Corrigido com `order by ci.product_id` na query do loop.

-- ---------------------------------------------------------------------
-- H1 — marcador de reserva de estoque por item de pedido.
-- ---------------------------------------------------------------------
-- order_items é um snapshot imutável (migration 20260817220033: "sem
-- updated_at de propósito") — esta coluna também nunca é reescrita
-- depois do INSERT. `DEFAULT false` faz TODO order_item já existente
-- (pedidos antigos, de antes de D19.1.2 sequer existir) nascer com
-- stock_reserved = false automaticamente — exatamente o comportamento
-- correto: nenhum pedido antigo decrementou estoque de verdade (a
-- coluna/tabela não existia), então nenhum deles pode "ganhar" estoque
-- artificial ao ser cancelado hoje, mesmo que o lojista defina controle
-- de estoque para o produto DEPOIS. Só create_order_from_cart grava
-- `true`, e só quando o decremento realmente aconteceu (D19.1.1 §8: um
-- produto sem linha em product_inventory nunca marca stock_reserved).
alter table public.order_items
  add column stock_reserved boolean not null default false;

comment on column public.order_items.stock_reserved is
  'D19.1.3.1 — true somente quando create_order_from_cart decrementou product_inventory de verdade para este item (produto tinha controle de estoque definido no momento da compra). Nunca reescrito depois do INSERT (snapshot imutável, mesmo princípio das demais colunas desta tabela) — é a fonte de verdade que update_order_status usa para saber o que restaurar ao cancelar, sem precisar reconsultar se o produto "tem" product_inventory HOJE (que pode ter mudado desde a compra).';

-- ---------------------------------------------------------------------
-- create_order_from_cart — mesma assinatura canônica de 10 parâmetros
-- (20260817220081, preservada por 20260817220109) — reproduzida
-- integralmente de novo. Dois acréscimos sobre a versão de
-- 20260817220109:
--   1. M1: `order by ci.product_id` na query do loop.
--   2. H1: grava `stock_reserved` em cada order_item, refletindo se o
--      decremento realmente aconteceu para aquele item.
-- Nenhuma outra regra (preço, quantidade, validação de tenant, criação
-- de order_items, limpeza do carrinho, payment_status/order_source/
-- cash_change_for) muda.
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
  'Cria pedido a partir do carrinho, atomicamente (transação única) — preço/total sempre recalculados no servidor, nunca aceitos do cliente. Lock do carrinho (for update) é a estratégia anti-duplicidade. Fase D2-B: p_order_source/p_payment_channel/p_requested_payment_method/p_cash_change_for são parâmetros opcionais (default vexo_checkout/gateway/null/null) sempre fixados pela Action chamadora, nunca por formData do cliente. D19.1.2: decrementa product_inventory atomicamente no mesmo loop quando o produto tem controle de estoque definido (ausência de linha = sem checagem, comportamento legado preservado). D19.1.3.1: loop em ordem determinística por product_id (previne deadlock entre checkouts concorrentes) e grava order_items.stock_reserved (fonte de verdade para a restauração de estoque em update_order_status).';

-- ---------------------------------------------------------------------
-- H1 — update_order_status: mesma assinatura, mesma máquina de estados,
-- mesma checagem de permissão, mesmo compare-and-swap atômico contra
-- concorrência (já existentes, migration 20260817220051) — único
-- acréscimo é a restauração de estoque, e SÓ depois que o
-- compare-and-swap acima confirma que a transição para CANCELLED
-- realmente aconteceu AGORA, nesta chamada.
--
-- Por que isto é idempotente e seguro sob concorrência/retry, sem
-- nenhum marcador/coluna nova em orders:
--   - CANCELLED é estado terminal na máquina de estados (nenhuma entrada
--     da lista de transições válidas tem 'CANCELLED' como origem) — uma
--     segunda chamada para cancelar o MESMO pedido já cancelado sempre
--     cai em "invalid order status transition", ANTES de chegar perto da
--     restauração.
--   - Sob duas chamadas concorrentes tentando cancelar o mesmo pedido a
--     partir do MESMO status de origem: o UPDATE ... WHERE status =
--     v_order.status (compare-and-swap já existente) garante que só UMA
--     das duas afeta alguma linha; a outra cai em "order status changed
--     concurrently, please retry" — também antes de chegar na
--     restauração.
--   - Logo, o bloco de restauração abaixo só é alcançado exatamente UMA
--     vez por pedido, no exato momento em que ele entra em CANCELLED
--     pela primeira (e única) vez — sem precisar de nenhuma coluna
--     "estoque já restaurado" nova.
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

  -- D19.1.3.1 (H1) — restaura estoque reservado, um único UPDATE ...
  -- FROM cobrindo todos os itens do pedido de uma vez (não é preciso
  -- iterar em loop: cada order_item já sabe, individualmente, se
  -- reservou estoque — oi.stock_reserved). `oi.product_id` pode ser NULL
  -- (produto excluído depois, ON DELETE SET NULL — migration
  -- 20260817220033) ou a linha de product_inventory pode ter sido
  -- removida pelo lojista desde a compra (produto voltou a "sem
  -- controle") — nos dois casos o JOIN simplesmente não encontra
  -- correspondência para aquele item, e nada é restaurado para ele
  -- (comportamento conservador e correto: não recria uma linha de
  -- estoque que o lojista explicitamente removeu).
  if p_new_status = 'CANCELLED' then
    update public.product_inventory pi
    set stock_quantity = pi.stock_quantity + oi.quantity,
        updated_at = now()
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.tenant_id = p_tenant_id
      and oi.stock_reserved
      and pi.product_id = oi.product_id
      and pi.tenant_id = p_tenant_id;
  end if;
end;
$$;

comment on function public.update_order_status(uuid, uuid, text, text) is
  'Único caminho para avançar orders.status depois da criação do pedido — valida a transição numa máquina de estados exaustiva no servidor, nunca confia num status vindo do cliente. Nunca altera payment_status nem dispara nenhuma operação financeira externa. D19.1.3.1: quando a transição resulta em CANCELLED, restaura atomicamente (mesma transação) o estoque de todo order_item com stock_reserved=true — idempotente por construção (CANCELLED é terminal na máquina de estados; o compare-and-swap já existente garante que a transição só acontece uma vez, mesmo sob concorrência/retry).';
