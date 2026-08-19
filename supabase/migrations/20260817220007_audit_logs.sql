-- Etapa 2 — audit_logs (arquitetura §5.9, §18.2, §25.1, §25.4).
--
-- Append-only por design: nenhuma policy de UPDATE/DELETE é criada em
-- nenhuma migration, e além disso (0015_rls_audit_logs) os privilégios de
-- UPDATE/DELETE são revogados da tabela para anon/authenticated/
-- service_role, e um trigger BEFORE UPDATE OR DELETE rejeita
-- incondicionalmente — porque service_role tem BYPASSRLS no Postgres e
-- RLS sozinha não bastaria (arquitetura §18.2/§25.1).
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete restrict,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'master', 'system')),
  action text not null,
  resource_type text,
  resource_id text,
  before jsonb,
  after jsonb,
  -- Decisão oficial da revisão de segurança (arquitetura §25.4, item 4):
  -- override manual de status financeiro/pagamento pelo Master exige
  -- motivo. A tabela de payments ainda não existe (etapa futura), mas a
  -- coluna e o constraint já nascem aqui para que a etapa que implementar
  -- o override não precise "lembrar" de adicionar essa proteção depois.
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  ip inet,
  user_agent text,
  request_id text,
  created_at timestamptz not null default now(),
  constraint audit_logs_payment_override_requires_reason
    check (action <> 'PAYMENT_OVERRIDE' or reason is not null)
);

comment on table public.audit_logs is
  'Trilha de auditoria append-only. tenant_id nulo = ação de escopo de plataforma (ex.: ações do MASTER que não pertencem a uma loja específica).';
comment on column public.audit_logs.reason is
  'Obrigatório para overrides financeiros (ver constraint audit_logs_payment_override_requires_reason) — arquitetura §25.4.';

create index audit_logs_tenant_id_idx on public.audit_logs (tenant_id);
create index audit_logs_actor_user_id_idx on public.audit_logs (actor_user_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);

-- RLS habilitada e forçada já aqui; a policy de SELECT (0015) depende de
-- private.is_tenant_member/is_platform_admin (0009). Escrita só é possível
-- via private.log_audit (0010), SECURITY DEFINER — nenhuma policy de
-- INSERT é criada para anon/authenticated/service_role, e os GRANTs
-- diretos de INSERT/UPDATE/DELETE nesses papéis também são revogados em
-- 0015.
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
