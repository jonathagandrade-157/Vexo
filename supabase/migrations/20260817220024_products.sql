-- Etapa 7 — produtos (arquitetura §6; prompt Etapa 7 §5/§6/§14).
--
-- Campos exatamente os do prompt (§5): sem variantes (§5 do prompt diz
-- explicitamente para não implementar nesta etapa, documentado como
-- decisão pendente no relatório final), sem custo/margem/marca/código de
-- barras/controle de estoque (nenhum estava na lista aprovada nem em
-- vexo_adicionar_produto_desktop além do que o Stitch chama de "Estoque",
-- que é a própria funcionalidade excluída).
--
-- `price`/`promotional_price` em `numeric(10,2)`, não float — dinheiro
-- nunca em ponto flutuante (prompt §6). `category_id` sem `on delete
-- cascade` nem `on delete set null`: o padrão do Postgres (NO ACTION) já
-- é a estratégia "impedir exclusão enquanto houver produtos" pedida no
-- prompt §15 — apagar uma categoria com produtos vinculados falha com
-- 23503 (foreign_key_violation), sem precisar de trigger nenhum para
-- essa regra específica.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  category_id uuid references public.categories (id),
  name text not null,
  slug text not null,
  description text,
  price numeric(10, 2) not null check (price >= 0),
  promotional_price numeric(10, 2) check (promotional_price >= 0),
  sku text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  main_image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_tenant_slug_unique unique (tenant_id, slug),
  constraint products_promotional_price_not_above_price
    check (promotional_price is null or promotional_price <= price)
);

comment on table public.products is
  'Produtos do catálogo, um por tenant (arquitetura Etapa 7). Sem variantes/estoque/custo — fora do escopo aprovado.';
comment on column public.products.main_image is
  'Path de Supabase Storage (não URL completa) — fundação apenas: não há upload real nesta etapa (Storage ainda não configurado em supabase/config.toml, sem como validar contra Supabase real neste ambiente). NULL até a etapa que implementar upload de verdade.';

create trigger set_updated_at
  before update on public.products
  for each row
  execute function private.set_updated_at();

create trigger prevent_tenant_id_change
  before update on public.products
  for each row
  execute function private.prevent_tenant_id_change();

-- Proteção contra "produto do tenant A + categoria do tenant B" (prompt
-- §14) — uma FK simples em category_id não garante isso sozinha, porque
-- FK só verifica que o id existe em categories, não que pertence ao
-- mesmo tenant do produto. SECURITY DEFINER: precisa ler categories,
-- que não tem policy de SELECT liberada para todo mundo que pode
-- escrever em products (só para membros do MESMO tenant da categoria).
create function private.prevent_cross_tenant_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = new.category_id and c.tenant_id = new.tenant_id
  ) then
    raise exception
      'products.category_id must belong to the same tenant as the product'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

create trigger prevent_cross_tenant_category
  before insert or update on public.products
  for each row
  execute function private.prevent_cross_tenant_category();

alter table public.products enable row level security;
alter table public.products force row level security;
