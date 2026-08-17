-- Etapa 2 — roles, permissions, role_permissions (arquitetura §5.1, §8).
--
-- DECISÃO CONFIRMADA (Etapa 1 §25.4 e reafirmada no prompt da Etapa 2):
-- papéis customizáveis por tenant ficam FORA do MVP. Diferente da v1 da
-- arquitetura, esta migration NÃO inclui uma coluna `tenant_id` em `roles`
-- "para o futuro" — isso seria uma coluna sem uso e sem constraint que a
-- torne segura hoje. Se papéis customizáveis forem aprovados depois, a
-- coluna entra numa migration própria, junto com o desenho de RLS que essa
-- funcionalidade exige (registrado como decisão pendente no relatório
-- final).
--
-- CONFLITO DE NOMENCLATURA DE PAPÉIS: o prompt desta etapa cita como
-- mínimo "OWNER, ADMIN, MANAGER, STAFF", mas ele mesmo instrui seguir o
-- documento de arquitetura quando os nomes divergirem. A arquitetura
-- aprovada usa OWNER, ADMIN, MANAGER, OPERATOR, SUPPORT (sem "STAFF") —
-- são esses cinco que foram criados aqui.
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.roles is
  'Papéis de sistema fixos (arquitetura §8). Papéis customizáveis por tenant ficam fora do MVP.';

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  group_name text not null,
  description text,
  created_at timestamptz not null default now()
);

comment on table public.permissions is
  'Catálogo de permissões no formato recurso.acao (arquitetura §8). Não é exaustivo — cresce conforme cada etapa introduz o recurso correspondente.';

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create index role_permissions_permission_id_idx
  on public.role_permissions (permission_id);

-- Seed de dados estáticos (papéis e permissões de sistema). Vive em uma
-- migration versionada — não em supabase/seed.sql, que só roda em
-- `supabase db reset` local e nunca é aplicado em produção — porque esta é
-- referência estrutural exigida em todo ambiente (arquitetura §19: "criar
-- seed somente para dados estáticos necessários, como roles/permissões
-- base").
insert into public.roles (key, name, is_system) values
  ('OWNER', 'Owner', true),
  ('ADMIN', 'Admin', true),
  ('MANAGER', 'Manager', true),
  ('OPERATOR', 'Operator', true),
  ('SUPPORT', 'Support', true);

-- Catálogo inicial de permissões — apenas as citadas explicitamente na
-- arquitetura (§8) e no prompt desta etapa, para os recursos que já têm
-- (ou terão em breve) uma tabela real. Não é o catálogo final: cada etapa
-- futura acrescenta as permissões do recurso que introduz.
insert into public.permissions (key, group_name, description) values
  ('products.view', 'products', 'Ver produtos'),
  ('products.create', 'products', 'Criar produtos'),
  ('products.update', 'products', 'Editar produtos'),
  ('products.delete', 'products', 'Excluir produtos'),
  ('orders.view', 'orders', 'Ver pedidos'),
  ('orders.update', 'orders', 'Atualizar pedidos'),
  ('customers.view', 'customers', 'Ver clientes'),
  ('customers.update', 'customers', 'Atualizar clientes'),
  ('settings.view', 'settings', 'Ver configurações da loja'),
  ('settings.update', 'settings', 'Atualizar configurações da loja'),
  ('team.view', 'team', 'Ver equipe'),
  ('team.manage', 'team', 'Gerenciar membros e papéis da equipe'),
  ('billing.view', 'billing', 'Ver assinatura/faturamento'),
  ('billing.manage', 'billing', 'Gerenciar assinatura/faturamento'),
  ('support.view', 'support', 'Ver chamados de suporte'),
  ('support.manage', 'support', 'Gerenciar chamados de suporte'),
  ('reports.view', 'reports', 'Ver relatórios');

-- Matriz role -> permissions, exatamente como descrita na arquitetura §8.
with role_perm (role_key, permission_key) as (
  values
    -- OWNER: todas as permissões existentes.
    ('OWNER', 'products.view'), ('OWNER', 'products.create'),
    ('OWNER', 'products.update'), ('OWNER', 'products.delete'),
    ('OWNER', 'orders.view'), ('OWNER', 'orders.update'),
    ('OWNER', 'customers.view'), ('OWNER', 'customers.update'),
    ('OWNER', 'settings.view'), ('OWNER', 'settings.update'),
    ('OWNER', 'team.view'), ('OWNER', 'team.manage'),
    ('OWNER', 'billing.view'), ('OWNER', 'billing.manage'),
    ('OWNER', 'support.view'), ('OWNER', 'support.manage'),
    ('OWNER', 'reports.view'),
    -- ADMIN: tudo exceto billing.
    ('ADMIN', 'products.view'), ('ADMIN', 'products.create'),
    ('ADMIN', 'products.update'), ('ADMIN', 'products.delete'),
    ('ADMIN', 'orders.view'), ('ADMIN', 'orders.update'),
    ('ADMIN', 'customers.view'), ('ADMIN', 'customers.update'),
    ('ADMIN', 'settings.view'), ('ADMIN', 'settings.update'),
    ('ADMIN', 'team.view'), ('ADMIN', 'team.manage'),
    ('ADMIN', 'support.view'), ('ADMIN', 'support.manage'),
    ('ADMIN', 'reports.view'),
    -- MANAGER: products.*, orders.*, customers.*.
    ('MANAGER', 'products.view'), ('MANAGER', 'products.create'),
    ('MANAGER', 'products.update'), ('MANAGER', 'products.delete'),
    ('MANAGER', 'orders.view'), ('MANAGER', 'orders.update'),
    ('MANAGER', 'customers.view'), ('MANAGER', 'customers.update'),
    -- OPERATOR: orders.view, orders.update, customers.view.
    ('OPERATOR', 'orders.view'), ('OPERATOR', 'orders.update'),
    ('OPERATOR', 'customers.view'),
    -- SUPPORT: support.view (leitura limitada).
    ('SUPPORT', 'support.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perm rp
join public.roles r on r.key = rp.role_key
join public.permissions p on p.key = rp.permission_key;

-- RLS: dados de referência globais, sem tenant_id. Leitura liberada a
-- qualquer usuário autenticado (necessário para a aplicação resolver a
-- matriz de permissões); nenhuma policy de escrita é criada — INSERT,
-- UPDATE e DELETE ficam bloqueados por padrão (RLS nega quando não há
-- policy), então só uma migration (rodando como owner/superuser) pode
-- alterar estes dados, nunca a aplicação em runtime.
alter table public.roles enable row level security;
alter table public.roles force row level security;
create policy "authenticated can read roles"
  on public.roles for select
  to authenticated
  using (true);

alter table public.permissions enable row level security;
alter table public.permissions force row level security;
create policy "authenticated can read permissions"
  on public.permissions for select
  to authenticated
  using (true);

alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;
create policy "authenticated can read role_permissions"
  on public.role_permissions for select
  to authenticated
  using (true);
