-- Etapa 7 — categorias de produtos (arquitetura §6; prompt Etapa 7 §4).
--
-- Campos exatamente os do prompt (§4) — nada adicionado "porque parece
-- útil". Flat (sem parent_id/hierarquia): a tela vexo_categorias_desktop
-- do Stitch mostra uma árvore com drag-and-drop, mas isso não está na
-- lista de campos aprovada nem foi pedido — reaproveitado só o padrão
-- visual da linha (ícone, nome, contagem, status, ações), não a
-- funcionalidade de hierarquia.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null,
  slug text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint categories_tenant_slug_unique unique (tenant_id, slug)
);

comment on table public.categories is
  'Categorias de produtos, uma por tenant (arquitetura Etapa 7). Flat — sem hierarquia pai/filho, fora do escopo aprovado.';
comment on constraint categories_tenant_slug_unique on public.categories is
  'Unicidade por tenant, não global — dois tenants podem ter a categoria "roupas" cada um. Garante corretude sob concorrência (duas requisições simultâneas criando o mesmo slug): a segunda sempre falha com 23505, nunca duas linhas com o mesmo slug.';

create trigger set_updated_at
  before update on public.categories
  for each row
  execute function private.set_updated_at();

-- Reaproveita o trigger genérico da Etapa 2 (0008) — "anexar em toda
-- tabela com tenant_id, presente e futura". Não duplica a lógica.
create trigger prevent_tenant_id_change
  before update on public.categories
  for each row
  execute function private.prevent_tenant_id_change();

alter table public.categories enable row level security;
alter table public.categories force row level security;
