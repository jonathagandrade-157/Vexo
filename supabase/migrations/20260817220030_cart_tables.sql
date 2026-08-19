-- Etapa 9 — carrinho (prompt Etapa 9 §5). Nenhuma estrutura de carrinho
-- existia (confirmado por busca antes de criar esta migration). Sem
-- coluna de preço em cart_items de propósito: o preço nunca é
-- armazenado no carrinho, é sempre derivado ao vivo de
-- products.price/promotional_price — é a própria garantia de "nunca
-- confiar em preço vindo do cliente" (nem existe um preço do cliente
-- para desconfiar). Sem customer_id/status especulativos: adicionar
-- depois (quando clientes/checkout existirem) é uma migration trivial,
-- não um redesenho.
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  -- Denormalizado (mesmo padrão de categories/products) — permite RLS e
  -- defesa em profundidade sem join, e é a coluna que o trigger abaixo
  -- confere contra o tenant do produto e do carrinho.
  tenant_id uuid not null references public.tenants (id),
  -- on delete cascade: produto excluído pelo lojista some do carrinho
  -- automaticamente — nunca uma referência quebrada exibida ao visitante.
  product_id uuid not null references public.products (id) on delete cascade,
  quantity integer not null check (quantity > 0 and quantity <= 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_items_cart_product_unique unique (cart_id, product_id)
);

create index cart_items_cart_id_idx on public.cart_items (cart_id);

alter table public.carts enable row level security;
alter table public.carts force row level security;
alter table public.cart_items enable row level security;
alter table public.cart_items force row level security;

create trigger set_updated_at before update on public.carts
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.cart_items
  for each row execute function private.set_updated_at();

create trigger prevent_tenant_id_change before update on public.carts
  for each row execute function private.prevent_tenant_id_change();
create trigger prevent_tenant_id_change before update on public.cart_items
  for each row execute function private.prevent_tenant_id_change();

-- Uma FK simples em product_id só garante que o produto existe, não que
-- pertence ao mesmo tenant do item/carrinho (mesma lacuna já fechada
-- para categories/products na Etapa 7). Status 'active' só é exigido no
-- INSERT (adicionar ao carrinho) — um item já adicionado cujo produto
-- foi desativado depois continua podendo ser removido/ter a quantidade
-- reduzida, só não pode ser incrementado além do que já não seria
-- aceito num INSERT novo (a UPDATE de quantity passa pelo mesmo caminho
-- de aplicação, que já reconfirma o produto antes de aceitar).
create function private.prevent_cross_tenant_cart_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_tenant uuid;
  v_product_tenant uuid;
  v_product_status text;
begin
  select tenant_id into v_cart_tenant from public.carts where id = new.cart_id;
  if v_cart_tenant is null or v_cart_tenant <> new.tenant_id then
    raise exception 'cart_items.tenant_id must match the parent cart''s tenant'
      using errcode = '23514';
  end if;

  select tenant_id, status into v_product_tenant, v_product_status
  from public.products where id = new.product_id;
  if v_product_tenant is null or v_product_tenant <> new.tenant_id then
    raise exception 'cart_items.product_id must belong to the same tenant as the cart item'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and v_product_status <> 'active' then
    raise exception 'cannot add an inactive product to the cart'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger prevent_cross_tenant_cart_item before insert or update on public.cart_items
  for each row execute function private.prevent_cross_tenant_cart_item();
