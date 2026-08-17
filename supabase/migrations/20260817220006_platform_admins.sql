-- Etapa 2 — platform_admins (arquitetura §5.1, §9, §25.1).
--
-- Representa a equipe MASTER da VEXO. Deliberadamente SEM `tenant_id` —
-- nunca deve ser confundida/misturada com tenant_members (arquitetura §5
-- do prompt original, reforçado no prompt desta etapa: "usuário comum não
-- pode... promover outro usuário").
create table public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role text not null check (role in ('MASTER', 'SUPPORT_AGENT')),
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Administradores da plataforma VEXO. Gestão exclusivamente fora do fluxo da aplicação — ver RLS e GRANTs em 0014_rls_platform_admins: nenhum papel usado pela aplicação (nem service_role) tem escrita aqui.';

-- RLS habilitada e forçada já aqui; policies (somente SELECT) chegam em
-- 0014, junto com os REVOKE explícitos de escrita.
alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
