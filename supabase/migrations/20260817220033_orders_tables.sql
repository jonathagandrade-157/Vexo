-- Etapa 10 — checkout: orders + order_items. Já previstas na arquitetura
-- (§5.3), adaptadas aqui para cliente CONVIDADO (sem tabela `customers`
-- ainda) — nome/e-mail/telefone direto em `orders`, não um
-- `customer_id`. Nenhuma estrutura reaproveitável existia (confirmado
-- por busca antes de criar).
create sequence public.orders_order_number_seq;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  -- Só para referência humana (exibido ao cliente/lojista) — NUNCA usado
  -- como chave de busca da página de confirmação (é sequencial e
  -- adivinhável; ver get_order_confirmation, que usa o `id`).
  order_number text not null unique,
  -- check (status in (...)) em vez de um enum fixo: cresce por migration
  -- quando os próximos estados forem aprovados (mesmo padrão de
  -- products.status/categories.status) — só PENDING nesta etapa, de
  -- propósito (prompt Etapa 10 §10: "não implementar toda a máquina de
  -- estados operacional").
  status text not null default 'PENDING' check (status in ('PENDING')),
  customer_name text not null check (char_length(customer_name) > 0),
  customer_email text not null check (char_length(customer_email) > 0),
  customer_phone text not null check (char_length(customer_phone) > 0),
  -- Snapshot do endereço no momento do pedido (prompt §5/§22) — uma
  -- edição futura do tenant/cliente nunca altera isto. Checagem
  -- estrutural mínima das chaves esperadas, além da validação Zod no
  -- servidor.
  shipping_address jsonb not null check (
    shipping_address ? 'zip' and shipping_address ? 'street' and shipping_address ? 'number'
    and shipping_address ? 'neighborhood' and shipping_address ? 'city' and shipping_address ? 'state'
  ),
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  -- Cupons/frete não existem ainda — 0 forçado pelo próprio banco, não
  -- só por convenção de aplicação (prompt §6: "discount_total deve
  -- permanecer 0" / "shipping_total deve permanecer 0"). Uma migration
  -- futura solta este `check` quando essas features forem aprovadas.
  discount_total numeric(10, 2) not null default 0 check (discount_total = 0),
  shipping_total numeric(10, 2) not null default 0 check (shipping_total = 0),
  total numeric(10, 2) not null check (total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches_components check (total = subtotal + shipping_total - discount_total)
);

create index orders_tenant_id_idx on public.orders (tenant_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id),
  -- on delete set null (não cascade): o produto pode ser excluído pelo
  -- lojista depois, mas o snapshot abaixo (nome/slug/preço) preserva o
  -- histórico do pedido intacto mesmo assim (prompt §6/§22).
  product_id uuid references public.products (id) on delete set null,
  product_name text not null check (char_length(product_name) > 0),
  product_slug text not null check (char_length(product_slug) > 0),
  quantity integer not null check (quantity > 0 and quantity <= 99),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
  -- Sem updated_at de propósito: é um snapshot imutável, nunca
  -- atualizado depois de criado.
);

create index order_items_order_id_idx on public.order_items (order_id);

alter table public.orders enable row level security;
alter table public.orders force row level security;
alter table public.order_items enable row level security;
alter table public.order_items force row level security;

create trigger set_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

create trigger prevent_tenant_id_change before update on public.orders
  for each row execute function private.prevent_tenant_id_change();
create trigger prevent_tenant_id_change before update on public.order_items
  for each row execute function private.prevent_tenant_id_change();
