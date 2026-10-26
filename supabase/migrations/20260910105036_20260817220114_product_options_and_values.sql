-- D20.1 — Catálogo de Opções de Produtos (fundação de Variações, arquitetura
-- D20 já aprovada em discovery). Cria SOMENTE product_options e
-- product_option_values — nenhuma variante (product_variants), nenhum
-- estoque por variante, nenhuma alteração em products/product_inventory/
-- carts/cart_items/orders/order_items/create_order_from_cart/
-- update_order_status. Migration puramente aditiva, sem backfill, sem
-- alterar dado existente.
--
-- Reaproveita integralmente padrões já existentes no projeto (nenhuma
-- arquitetura de segurança nova):
--   - RLS staff gated por has_permission(tenant_id, 'products.<ação>') —
--     as MESMAS 3 permission keys já usadas por product_inventory
--     (migration 20260817220109), nenhuma permission nova.
--   - Triggers genéricos private.set_updated_at / private.prevent_tenant_id_change.
--   - Padrão prevent_cross_tenant_* já repetido 4x no projeto (categories→
--     products, product_inventory→products, cart_items→carts/products,
--     orders.customer_id→customers) — aqui replicado 2x, uma vez por nível
--     de aninhamento (product_options→products, product_option_values→
--     product_options).
--   - SELECT público (anon) restrito a produto ativo de tenant não
--     suspenso/excluído — mesmo filtro de duas camadas já usado por
--     products/categories/product_inventory.

-- ---------------------------------------------------------------------
-- product_options
-- ---------------------------------------------------------------------
create table public.product_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(name) > 0 and name = trim(name)),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_options is
  'D20.1 — definição de uma opção de um produto (ex.: "Cor", "Tamanho"), escopada POR PRODUTO (não uma biblioteca global reaproveitável entre produtos nesta v1 — arquitetura D20 §"product_options"). Fundação para product_variants (D20.2, ainda não criada).';
comment on column public.product_options.name is
  'Capitalização original preservada para exibição — a unicidade case-insensitive é garantida pelo índice único sobre lower(name) abaixo, nunca por uma coluna normalizada separada.';

-- Unicidade equivalente a UNIQUE(product_id, lower(name)) — expressão sobre
-- lower(name) exige CREATE UNIQUE INDEX (uma constraint UNIQUE de tabela só
-- aceita colunas, não expressões), mesma técnica de índice único já usada
-- no projeto para dedup condicional (ex.: customers_tenant_phone_unique_no_email,
-- migration 20260817220112). Também cobre o padrão de acesso "opções de um
-- produto" com product_id como coluna líder — nenhum índice extra em
-- product_id é necessário além deste (evita duplicar índice implícito).
create unique index product_options_product_name_unique
  on public.product_options (product_id, lower(name));

create trigger set_updated_at
  before update on public.product_options
  for each row
  execute function private.set_updated_at();

create trigger prevent_tenant_id_change
  before update on public.product_options
  for each row
  execute function private.prevent_tenant_id_change();

-- Mesma lacuna que prevent_cross_tenant_category/prevent_cross_tenant_product_inventory/
-- prevent_cross_tenant_cart_item já fecham: uma FK simples em product_id só
-- garante que o produto existe, nunca que pertence ao MESMO tenant_id desta
-- linha.
create function private.prevent_cross_tenant_product_option()
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
      'product_options.product_id must belong to the same tenant as product_options.tenant_id'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

create trigger prevent_cross_tenant_product_option
  before insert or update on public.product_options
  for each row
  execute function private.prevent_cross_tenant_product_option();

alter table public.product_options enable row level security;
alter table public.product_options force row level security;

-- Staff do painel: mesmas permission keys de products (products.view/
-- products.update/products.delete, Etapa 2/7) — nenhuma permission key
-- nova, mesmo reaproveitamento já feito por product_inventory.
create policy "tenant staff with products.view can select product options"
  on public.product_options for select
  to authenticated
  using (private.has_permission(tenant_id, 'products.view') or private.is_platform_admin());

create policy "tenant staff with products.update can insert product options"
  on public.product_options for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.update can update product options"
  on public.product_options for update
  to authenticated
  using (private.has_permission(tenant_id, 'products.update'))
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.delete can delete product options"
  on public.product_options for delete
  to authenticated
  using (private.has_permission(tenant_id, 'products.delete'));

-- anon (storefront público): mesmo padrão de menor privilégio já usado para
-- products/categories/product_inventory — só linhas cujo produto está ativo
-- e cujo tenant está publicado, nunca alargado para `authenticated`. Sem
-- NENHUMA policy de escrita para anon.
create policy "anyone can view options of active products of publicly visible tenants"
  on public.product_options for select
  to anon
  using (
    exists (
      select 1 from public.products p
      join public.tenants t on t.id = p.tenant_id
      where p.id = product_options.product_id
        and p.status = 'active'
        and t.status not in ('suspended', 'deleted')
    )
  );

-- Nenhum GRANT explícito de tabela é necessário: product_options é criada
-- rodando como `postgres`, então já herda automaticamente select/insert/
-- update/delete para anon/authenticated/service_role via `alter default
-- privileges` (migration 20260817220067) — RLS acima continua sendo a
-- única autoridade real sobre quais linhas cada papel alcança (mesma nota
-- já registrada em product_inventory).

-- ---------------------------------------------------------------------
-- product_option_values
-- ---------------------------------------------------------------------
create table public.product_option_values (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  product_option_id uuid not null references public.product_options (id) on delete cascade,
  value text not null check (char_length(value) > 0 and value = trim(value)),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_option_values is
  'D20.1 — um valor possível de uma product_options (ex.: "Preto", "M"), escopado por opção. Fundação para product_variants (D20.2, ainda não criada) — a identidade de uma variante virá de um conjunto destes valores, não desta tabela sozinha.';
comment on column public.product_option_values.value is
  'Capitalização original preservada para exibição (ex.: "GG" nunca vira "gg") — a unicidade case-insensitive é garantida pelo índice único sobre lower(value) abaixo, nunca por uma coluna normalizada separada. "Preto" e "preto" são o MESMO valor para fins de unicidade.';

-- Unicidade equivalente a UNIQUE(product_option_id, lower(value)) — mesma
-- técnica/motivo do índice análogo em product_options acima. product_option_id
-- como coluna líder também cobre o padrão de acesso "valores de uma opção",
-- nenhum índice extra em product_option_id é necessário.
create unique index product_option_values_option_value_unique
  on public.product_option_values (product_option_id, lower(value));

create trigger set_updated_at
  before update on public.product_option_values
  for each row
  execute function private.set_updated_at();

create trigger prevent_tenant_id_change
  before update on public.product_option_values
  for each row
  execute function private.prevent_tenant_id_change();

-- Mesmo padrão de prevent_cross_tenant_product_option acima, um nível mais
-- fundo: valida que product_option_id pertence ao MESMO tenant_id desta
-- linha (que, transitivamente, já garante o mesmo product_id/tenant que o
-- trigger acima garantiu para a opção).
create function private.prevent_cross_tenant_product_option_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.product_options po
    where po.id = new.product_option_id and po.tenant_id = new.tenant_id
  ) then
    raise exception
      'product_option_values.product_option_id must belong to the same tenant as product_option_values.tenant_id'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

create trigger prevent_cross_tenant_product_option_value
  before insert or update on public.product_option_values
  for each row
  execute function private.prevent_cross_tenant_product_option_value();

alter table public.product_option_values enable row level security;
alter table public.product_option_values force row level security;

create policy "tenant staff with products.view can select product option values"
  on public.product_option_values for select
  to authenticated
  using (private.has_permission(tenant_id, 'products.view') or private.is_platform_admin());

create policy "tenant staff with products.update can insert product option values"
  on public.product_option_values for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.update can update product option values"
  on public.product_option_values for update
  to authenticated
  using (private.has_permission(tenant_id, 'products.update'))
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.delete can delete product option values"
  on public.product_option_values for delete
  to authenticated
  using (private.has_permission(tenant_id, 'products.delete'));

-- anon (storefront público): mesmo filtro de duas camadas, agora percorrendo
-- product_option_values → product_options → products → tenants.
create policy "anyone can view option values of active products of publicly visible tenants"
  on public.product_option_values for select
  to anon
  using (
    exists (
      select 1 from public.product_options po
      join public.products p on p.id = po.product_id
      join public.tenants t on t.id = p.tenant_id
      where po.id = product_option_values.product_option_id
        and p.status = 'active'
        and t.status not in ('suspended', 'deleted')
    )
  );

-- Nenhum GRANT explícito de tabela é necessário (mesma nota de
-- product_options acima) — RLS é a única autoridade real.
