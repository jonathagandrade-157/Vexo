-- D19.1.2 — controle real de estoque (D19.1.1 discovery aprovado).
--
-- public.product_inventory: tabela SEPARADA de products, 1:1 por enquanto
-- (unique em product_id) — deliberadamente não uma coluna em products
-- (D19.1.1 §5: uma coluna exigiria migrar o dado inteiro quando D19.3
-- introduzir variações; a tabela separada só ganha um `variant_id`
-- opcional naquele momento, nunca um redesenho). D19.3 NÃO é
-- implementado aqui — nenhuma coluna/tabela de variação é criada nesta
-- migration, por instrução explícita do ticket.
--
-- AUSÊNCIA DE LINHA = "estoque ainda não definido" (D19.1.1 §8, decisão
-- confirmada no ticket): nenhum produto existente recebe uma linha
-- automática com 0/999/qualquer valor. `create_order_from_cart` (redefinida
-- abaixo) só aplica a checagem/decremento de estoque para produtos que TÊM
-- uma linha aqui — um produto sem linha continua vendendo exatamente como
-- hoje, sem bloqueio silencioso e sem venda infinita "por acidente": a
-- ausência de controle é uma escolha visível do lojista (não preencheu o
-- campo de estoque), nunca um estado inventado por esta migration.
create table public.product_inventory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  -- on delete cascade (diferente de order_items.product_id, que usa SET
  -- NULL para preservar histórico): estoque não tem sentido sem o
  -- produto — excluir o produto deve excluir seu registro de estoque
  -- junto, nunca deixar uma linha órfã nem bloquear a exclusão do
  -- produto com um erro de FK (23503).
  product_id uuid not null references public.products (id) on delete cascade,
  stock_quantity integer not null check (stock_quantity >= 0),
  low_stock_threshold integer check (low_stock_threshold is null or low_stock_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_inventory_product_id_unique unique (product_id)
);

comment on table public.product_inventory is
  'D19.1.2 — estoque real por produto, tabela separada de products (1:1 hoje; variant_id NULL previsto para D19.3, não criado ainda). Ausência de linha para um product_id = "estoque não controlado" (produto legado ou lojista optou por não definir), nunca inferido como 0 nem como ilimitado por acidente — create_order_from_cart só aplica a checagem quando a linha existe.';
comment on column public.product_inventory.stock_quantity is
  'CHECK (>= 0) é a segunda camada anti-overselling, além do UPDATE condicional em create_order_from_cart (D19.1.1 §6) — nunca fica negativo mesmo sob falha de aplicação.';

create index product_inventory_tenant_id_idx on public.product_inventory (tenant_id);

create trigger set_updated_at
  before update on public.product_inventory
  for each row
  execute function private.set_updated_at();

-- Reaproveita o trigger genérico já usado por products/categories/carts/etc.
create trigger prevent_tenant_id_change
  before update on public.product_inventory
  for each row
  execute function private.prevent_tenant_id_change();

-- Mesma lacuna que prevent_cross_tenant_category (products, migration
-- 20260817220024) e prevent_cross_tenant_cart_item (cart_items, migration
-- 20260817220030) já fecham: uma FK simples em product_id só garante que
-- o produto existe, nunca que pertence ao MESMO tenant_id desta linha.
create function private.prevent_cross_tenant_product_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.products p
    where p.id = new.product_id and p.tenant_id = new.tenant_id
  ) then
    raise exception
      'product_inventory.product_id must belong to the same tenant as product_inventory.tenant_id'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

create trigger prevent_cross_tenant_product_inventory
  before insert or update on public.product_inventory
  for each row
  execute function private.prevent_cross_tenant_product_inventory();

alter table public.product_inventory enable row level security;
alter table public.product_inventory force row level security;

-- Staff do painel: mesmas permission keys de products (products.view/
-- products.update, Etapa 2/7) — nenhuma permission key nova (ticket
-- D19.1.2 "SEGURANÇA": "Não criar nova permission key").
create policy "tenant staff with products.view can select product inventory"
  on public.product_inventory for select
  to authenticated
  using (private.has_permission(tenant_id, 'products.view') or private.is_platform_admin());

create policy "tenant staff with products.update can insert product inventory"
  on public.product_inventory for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.update can update product inventory"
  on public.product_inventory for update
  to authenticated
  using (private.has_permission(tenant_id, 'products.update'))
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.update can delete product inventory"
  on public.product_inventory for delete
  to authenticated
  using (private.has_permission(tenant_id, 'products.update'));

-- anon (storefront público): necessário para a página de produto decidir
-- "Indisponível"/desabilitar o botão de compra ANTES do checkout (ticket
-- D19.1.2 "STOREFRONT") — mesmo padrão de menor privilégio já usado para
-- products/categories/shipping_methods (Etapas 6/7/12): só linhas cujo
-- produto está ativo e cujo tenant está publicado, nunca alargado para
-- `authenticated` (lição da Etapa 6). `stock_quantity` não é dado sensível
-- (mesma categoria de exposição que `products.price`, já público).
create policy "anyone can view stock of active products of publicly visible tenants"
  on public.product_inventory for select
  to anon
  using (
    exists (
      select 1 from public.products p
      join public.tenants t on t.id = p.tenant_id
      where p.id = product_inventory.product_id
        and p.status = 'active'
        and t.status not in ('suspended', 'deleted')
    )
  );

-- Nenhum GRANT explícito de tabela é necessário: `product_inventory` é
-- criada rodando como `postgres`, então já herda automaticamente
-- select/insert/update/delete para anon/authenticated/service_role via
-- `alter default privileges` (migration 20260817220067) — RLS acima
-- continua sendo a única autoridade real sobre quais linhas cada papel
-- alcança.

-- ---------------------------------------------------------------------
-- Auditoria — estende o MESMO mecanismo já usado por tenants/categories/
-- products/storefront_banners (trigger dedicado por tabela, sempre
-- SECURITY DEFINER + private.log_audit(), nunca um sistema paralelo).
-- product_inventory é uma tabela própria (não uma coluna de products),
-- então ganha seu próprio trigger — mesmo padrão já usado para
-- storefront_banners (migration 20260817220108), nunca reaproveitando
-- literalmente audit_product_changes (que está amarrada à tabela
-- products).
--
-- UPDATE só é auditado quando `auth.role() <> 'anon'` (ticket: "Registrar
-- ajuste manual de estoque" — o decremento automático do checkout roda
-- como `anon`, dentro de create_order_from_cart). Duas razões para essa
-- exclusão, não só estilo:
--   1. Escopo: o ticket pede para auditar o AJUSTE MANUAL, não cada
--      decremento de venda (isso poluiria audit_logs com um evento por
--      item de pedido vendido, sem pedir isso explicitamente).
--   2. Segurança: private.log_audit() rejeita (exceção) logar em nome de
--      um tenant quando o ator não é membro/platform admin/service_role/
--      uma das exceções já existentes e estreitas (ORDER_CREATED,
--      PAYMENT_CREATED — migrations 20260817220035/044). Um checkout
--      anônimo NÃO é nada disso; chamar log_audit para um evento novo,
--      sem essa exceção, derrubaria a transação inteira de
--      create_order_from_cart. Em vez de alargar a guarda de log_audit
--      (fora do escopo deste ticket, e um ponto sensível para mexer sem
--      necessidade real), o trigger simplesmente não tenta auditar a
--      escrita anônima — o decremento em si continua acontecendo
--      normalmente, só não gera uma linha em audit_logs.
create function private.audit_product_inventory_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'PRODUCT_STOCK_DEFINED', 'product_inventory', new.id::text,
      null,
      jsonb_build_object('product_id', new.product_id, 'stock_quantity', new.stock_quantity, 'low_stock_threshold', new.low_stock_threshold)
    );
  elsif tg_op = 'UPDATE' and old.stock_quantity is distinct from new.stock_quantity and auth.role() <> 'anon' then
    perform private.log_audit(
      new.tenant_id, 'PRODUCT_STOCK_ADJUSTED', 'product_inventory', new.id::text,
      jsonb_build_object('stock_quantity', old.stock_quantity), jsonb_build_object('stock_quantity', new.stock_quantity)
    );
  elsif tg_op = 'DELETE' then
    perform private.log_audit(
      old.tenant_id, 'PRODUCT_STOCK_REMOVED', 'product_inventory', old.id::text,
      jsonb_build_object('product_id', old.product_id, 'stock_quantity', old.stock_quantity), null
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger audit_product_inventory_changes
  after insert or update or delete on public.product_inventory
  for each row
  execute function private.audit_product_inventory_changes();

-- ---------------------------------------------------------------------
-- create_order_from_cart — a versão CANÔNICA hoje é a de 10 parâmetros
-- definida por 20260817220081 (Fase D2-B: order_source/payment_channel/
-- requested_payment_method/cash_change_for, todos opcionais com default),
-- não a de 6 parâmetros de 20260817220036. Reproduzida aqui INTEGRALMENTE
-- (mesma validação, mesmo DECLARE, mesma lógica de payment_status/troco) —
-- CREATE OR REPLACE só substitui de fato quando a lista de tipos de
-- parâmetro é IDÊNTICA à já existente (mesmo aviso já registrado no
-- cabeçalho de 220081): usar a assinatura de 6 parâmetros aqui criaria um
-- SEGUNDO overload ambíguo ("is not unique"), quebrando toda chamada
-- existente — erro cometido e corrigido durante a validação local desta
-- própria migration antes de qualquer aplicação real.
--
-- Único acréscimo de fato: o decremento atômico de estoque, DENTRO do
-- mesmo loop e da mesma transação, exatamente como o D19.1.1 §4/§6
-- concluiu ser o único ponto correto — nunca uma segunda chamada, nunca
-- depois do INSERT/RETURN, nunca uma reserva no carrinho. Grants de
-- EXECUTE (anon) persistem através de CREATE OR REPLACE sobre a mesma
-- assinatura, nunca precisam ser reafirmados.
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

    -- D19.1.2 — decremento atômico de estoque. Ausência de linha em
    -- product_inventory para este produto = "estoque não controlado"
    -- (D19.1.1 §8): a venda segue exatamente como antes desta migration,
    -- sem checagem nenhuma. Só produtos COM uma linha aqui entram no
    -- controle real — e, para esses, o UPDATE condicional abaixo é a
    -- própria trava de concorrência (D19.1.1 §6): o lock de linha
    -- implícito do UPDATE serializa dois checkouts concorrentes do mesmo
    -- produto, e o segundo a chegar reavalia `stock_quantity >=
    -- v_item.quantity` já contra o valor commitado pelo primeiro.
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

  if p_cash_change_for is not null and p_cash_change_for < v_subtotal then
    raise exception 'cash change amount is less than the order subtotal' using errcode = 'P0001';
  end if;

  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;

  delete from public.cart_items where cart_id = p_cart_id and tenant_id = p_tenant_id;

  return v_order_id;
end;
$$;

comment on function public.create_order_from_cart(uuid, uuid, text, text, text, jsonb, text, text, text, numeric) is
  'Cria pedido a partir do carrinho, atomicamente (transação única) — preço/total sempre recalculados no servidor, nunca aceitos do cliente. Lock do carrinho (for update) é a estratégia anti-duplicidade. Fase D2-B: p_order_source/p_payment_channel/p_requested_payment_method/p_cash_change_for são parâmetros opcionais (default vexo_checkout/gateway/null/null) sempre fixados pela Action chamadora, nunca por formData do cliente. D19.1.2: decrementa product_inventory atomicamente no mesmo loop quando o produto tem controle de estoque definido (ausência de linha = sem checagem, comportamento legado preservado).';
