-- Etapa 3 — trial_eligibility, trial_records (arquitetura §5.5, §13).
--
-- `trial_eligibility` guarda só o hash do documento (nunca o CPF/CNPJ em
-- texto puro — arquitetura §13/§25.1). A única forma de ler ou escrever é
-- através de public.start_trial_for_tenant() (migration seguinte) — o que
-- evita expor um jeito de "sondar" se um hash já foi usado fora do próprio
-- fluxo de cadastro.
create table public.trial_eligibility (
  id uuid primary key default gen_random_uuid(),
  document_hash text not null unique,
  first_tenant_id uuid not null references public.tenants (id),
  created_at timestamptz not null default now()
);

comment on table public.trial_eligibility is
  'Um trial por CPF/CNPJ (hash HMAC, nunca o documento em texto puro). Escrita só via public.start_trial_for_tenant().';

alter table public.trial_eligibility enable row level security;
alter table public.trial_eligibility force row level security;

-- Sem nenhuma policy de SELECT/INSERT/UPDATE/DELETE para anon/authenticated
-- já bloqueia essas duas (RLS nega por padrão sem policy — mas isso, por
-- si só, filtra silenciosamente em vez de negar com erro, e não bloqueia
-- service_role, que tem BYPASSRLS). Mesmo padrão de defesa em profundidade
-- de platform_admins/audit_logs (0014/0015): REVOKE explícito dos quatro
-- privilégios, das três roles de aplicação — nenhuma delas precisa de
-- acesso direto à tabela, porque start_trial_for_tenant() (SECURITY
-- DEFINER, roda como o dono da função) nunca passa por esses GRANTs.
revoke select, insert, update, delete on public.trial_eligibility
  from anon, authenticated, service_role;

-- `trial_records` é o estado do trial de um tenant. Membros do próprio
-- tenant podem ler (para telas como "início do trial: sucesso" e, depois,
-- o dashboard mostrando dias restantes); escrita só via
-- start_trial_for_tenant() nesta etapa — a transição para
-- expired/converted (job diário / conversão de plano) fica para as Etapas
-- 8+, junto com o gate central private.tenant_access_status() (arquitetura
-- §13.1), que também não é desta etapa.
--
-- `converted_plan_id`/`converted_at` (citados na arquitetura §5.5) não
-- existem ainda: não há tabela `plans` para referenciar até a Etapa 8, e
-- nenhum código desta etapa os preencheria — entram como uma migration
-- aditiva quando a Etapa 8 existir, em vez de uma coluna sem uso agora.
create table public.trial_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete restrict,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'converted', 'expired')),
  created_at timestamptz not null default now(),
  constraint trial_records_ends_after_start check (ends_at > started_at)
);

comment on table public.trial_records is
  'Um trial por tenant (unique tenant_id). started_at/ends_at definem a janela de 30 dias (arquitetura §13).';

create index trial_records_status_idx on public.trial_records (status);

alter table public.trial_records enable row level security;
alter table public.trial_records force row level security;

create policy "tenant members and platform admins can select trial_records"
  on public.trial_records for select
  to authenticated
  using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

-- Sem policy de INSERT/UPDATE/DELETE para authenticated: escrita só via
-- public.start_trial_for_tenant() (SECURITY DEFINER, próxima migration).

create trigger prevent_tenant_id_change
  before update on public.trial_records
  for each row
  execute function private.prevent_tenant_id_change();
