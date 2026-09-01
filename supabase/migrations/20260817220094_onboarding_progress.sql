-- D12.2 — public.onboarding_progress: substitui o modelo "um único UPDATE
-- conclui tudo" (D12.0) por progresso real por etapa. Modelo B/híbrido
-- recomendado em D12.1 §D — uma linha por (tenant, step), nunca duplica
-- dado de negócio (produtos/aparência/etc. continuam em suas próprias
-- tabelas; esta tabela só registra QUE o lojista confirmou aquela etapa
-- do wizard, e QUANDO).
--
-- `tenants.onboarding_completed_at` (migration 20260817220018) continua
-- existindo e continua sendo a única fonte lida por
-- `resolveOnboardingTenant`/`resolveActiveTenantForUser`/
-- `resolveStorefrontTenant`/`app/painel/layout.tsx` — nenhum desses
-- consumidores muda. Só quem escreve nesse campo muda: antes, um único
-- UPDATE do formulário; agora, `recomputeOnboardingCompletion`
-- (features/onboarding/progress.ts), chamado depois de cada etapa
-- concluída, que só grava a coluna quando todas as etapas `required` da
-- definição do business_type do tenant já têm `completed_at` aqui.
create table public.onboarding_progress (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  step_key text not null,
  completed_at timestamptz,
  data jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, step_key)
);

comment on table public.onboarding_progress is
  'Progresso do wizard de onboarding multi-etapa (D12.2), uma linha por (tenant, step_key). completed_at NULL = etapa ainda não confirmada pelo lojista (nunca inferido silenciosamente — só gravado por ação explícita, ver features/onboarding/actions.ts). data é um jsonb opcional para a etapa guardar um retalho do que preencheu (ex.: business_type escolhido), nunca a fonte de verdade de dado de negócio (isso sempre mora na tabela real da feature — tenants, products, etc.).';
comment on column public.onboarding_progress.step_key is
  'Chave estável do step (ex. "seu-negocio", "produtos") — nunca um índice numérico; definida em features/onboarding/step-definitions.ts. Não há FK para uma tabela de definições porque a definição é estática em código (D12.1 §H), não dado.';

-- PK composta (tenant_id, step_key) já cobre o caso de uso de leitura
-- mais comum ("todo o progresso deste tenant"), mas um índice dedicado
-- documenta a intenção e cobre buscas que não usam step_key.
create index onboarding_progress_tenant_id_idx on public.onboarding_progress (tenant_id);

create trigger set_updated_at
  before update on public.onboarding_progress
  for each row
  execute function private.set_updated_at();

alter table public.onboarding_progress enable row level security;
alter table public.onboarding_progress force row level security;

-- Mesma permission key que já protege tenants.* (settings.update,
-- migration 20260817220012) — onboarding é configuração de loja, mesma
-- categoria, nenhuma permission key nova criada (instrução explícita
-- D12.2). `private.is_platform_admin()` incluído pelo mesmo motivo da
-- policy de tenants: suporte/operação da plataforma precisa conseguir
-- inspecionar/depurar progresso de onboarding sem virar membro do tenant.
create policy "tenant staff with settings.update can view onboarding progress"
  on public.onboarding_progress for select
  to authenticated
  using (private.has_permission(tenant_id, 'settings.update') or private.is_platform_admin());

create policy "tenant staff with settings.update can insert onboarding progress"
  on public.onboarding_progress for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'settings.update') or private.is_platform_admin());

create policy "tenant staff with settings.update can update onboarding progress"
  on public.onboarding_progress for update
  to authenticated
  using (private.has_permission(tenant_id, 'settings.update') or private.is_platform_admin())
  with check (private.has_permission(tenant_id, 'settings.update') or private.is_platform_admin());

-- Sem policy de DELETE: nenhum fluxo desta etapa remove progresso —
-- RLS forçada sem policy = bloqueado por padrão (mesmo princípio de
-- "nunca aberto por descuido" já usado em tenants, migration
-- 20260817220004).
