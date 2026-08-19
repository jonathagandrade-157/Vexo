-- Etapa 2 — tenant_members (arquitetura §5.1, §6).
--
-- CONFLITO IDENTIFICADO COM O PROMPT DA ETAPA 2 (registrado, resolvido a
-- favor da opção mais segura/compatível com o já aprovado): o prompt lista
-- só `id, tenant_id, user_id, role_id, created_at, updated_at`, sem
-- `status`/`invited_by`. A arquitetura aprovada (§5.1) já reservava
-- `status` (invited|active|removed) porque `private.is_tenant_member`
-- (0009_auth_helper_functions) e todo o modelo de RLS do storefront
-- (arquitetura §3.4) dependem de conseguir diferenciar um convite
-- pendente de uma associação ativa. Remover a coluna agora só para bater
-- com a lista mínima do prompt criaria uma migration de quebra
-- (ALTER TABLE ADD COLUMN NOT NULL) assim que a Etapa 3/4 precisar dela, e
-- ainda deixaria `is_tenant_member` sem como diferenciar convite de
-- associação ativa. Mantidas `status` e `invited_by` (nullable, sem uso
-- ainda — nenhum fluxo de convite existe nesta etapa).
create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  status text not null default 'active'
    check (status in ('invited', 'active', 'removed')),
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

comment on table public.tenant_members is
  'Associação user -> tenant -> role. RLS (0013) e o trigger anti-auto-escalação (0009) protegem contra auto-promoção a OWNER.';

create index tenant_members_user_id_idx on public.tenant_members (user_id);
create index tenant_members_role_id_idx on public.tenant_members (role_id);

create trigger set_updated_at
  before update on public.tenant_members
  for each row
  execute function private.set_updated_at();

-- RLS habilitada e forçada já aqui; policies chegam em 0013, depois que
-- as funções auxiliares existirem. Até lá, totalmente bloqueada por
-- padrão.
alter table public.tenant_members enable row level security;
alter table public.tenant_members force row level security;
