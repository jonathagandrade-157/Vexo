-- Etapa 2 — tenants (arquitetura §5.1, §3).
--
-- `id` (uuid) é o único identificador usado para segurança/isolamento.
-- `slug` é só um identificador amigável de URL — nunca usado em policy de
-- RLS nem em nenhuma decisão de autorização (arquitetura §5, item 5 do
-- prompt desta etapa: "nunca usar nome da loja como identificador de
-- segurança").
--
-- RLS e as policies de UPDATE/status ficam numa migration posterior
-- (0012_rls_tenants), depois que as funções auxiliares
-- (private.is_tenant_member, private.is_platform_admin, ...) existirem —
-- ver 0009_auth_helper_functions. Até lá a tabela já nasce com RLS
-- habilitada e forçada, então fica completamente bloqueada por padrão
-- (nenhuma policy = nenhum acesso), nunca "aberta por descuido".
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'pending'
    check (status in ('active', 'suspended', 'pending', 'deleted')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table public.tenants is
  'Uma loja. id é o identificador de segurança; slug é só cosmético/URL.';
comment on column public.tenants.created_by is
  'Quem criou o tenant (via public.create_tenant) — usado por auditoria e por futuros sinais de elegibilidade de trial (arquitetura §13).';

create index tenants_status_idx on public.tenants (status);

create trigger set_updated_at
  before update on public.tenants
  for each row
  execute function private.set_updated_at();

alter table public.tenants enable row level security;
alter table public.tenants force row level security;
