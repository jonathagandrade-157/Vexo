-- Etapa 14 — subscriptions: fundação de assinatura (prompt §8/§9).
--
-- `tenant → subscription → plan`, não `tenants.plan = 'pro'` (prompt §8
-- explicitamente pede para evitar a coluna solta). `tenant_id unique`:
-- uma assinatura corrente por tenant nesta etapa (histórico de mudanças
-- de plano fica em audit_logs via TENANT_PLAN_CHANGED, migration
-- seguinte — não uma tabela de histórico própria, mesmo princípio já
-- usado em orders/shipping/pagamentos: nunca duplicar o que audit_logs
-- já cobre).
--
-- SEM nenhuma coluna de cobrança real (gateway_customer_id,
-- payment_method_id, external_subscription_id, etc.) — prompt §9: "NÃO
-- integrar gateway nesta etapa". Essas colunas entram por migration
-- aditiva quando a cobrança de verdade for implementada, exatamente como
-- converted_plan_id ficou de fora de trial_records até esta etapa (Etapa
-- 3, comentário original).
--
-- Não é uma linha criada automaticamente por create_tenant() (Etapa 2,
-- inalterada) — um tenant sem subscription cai para trial_records puro
-- em tenant_access_status() (migration seguinte), nunca fica sem
-- resposta.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id),
  plan_id uuid not null references public.plans (id),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired', 'suspended')),
  -- Nulo enquanto ainda em trial (nenhum ciclo escolhido) — só passa a
  -- ter valor quando uma assinatura de verdade começar (etapa futura).
  billing_cycle text check (billing_cycle is null or billing_cycle in ('monthly', 'yearly')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  -- Preparatórias (ajuste arquitetural pedido explicitamente) — nulas
  -- por enquanto, nunca escritas por nenhum código desta etapa.
  -- trial_records (Etapa 3) continua sendo a ÚNICA fonte de trial em
  -- uso — tenant_access_status() nunca lê estas duas colunas. Existem
  -- só para uma etapa futura em que uma subscription já vinculada a um
  -- plano específico precise de sua própria janela de trial (ex.: trial
  -- de um upgrade), sem exigir alterar o schema outra vez então.
  trial_start timestamptz,
  trial_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'Associação corrente tenant↔plano (prompt §8/§9) — fundação, sem cobrança real. Uma linha por tenant; mudança de plano é UPDATE, histórico fica em audit_logs (TENANT_PLAN_CHANGED).';

create index subscriptions_plan_id_idx on public.subscriptions (plan_id);
create index subscriptions_status_idx on public.subscriptions (status);

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

create trigger set_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_id_change before update on public.subscriptions
  for each row execute function private.prevent_tenant_id_change();

-- Leitura: membros do próprio tenant (para o painel do lojista mostrar
-- "seu plano atual") + platform admin. Escrita: só MASTER (prompt §26:
-- "tenant nunca pode alterar o próprio plano diretamente") — nesta etapa
-- não existe nenhum fluxo de autoatendimento, toda atribuição de plano é
-- manual pelo MASTER.
create policy "tenant members and platform admins can select subscriptions"
  on public.subscriptions for select
  to authenticated
  using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

create policy "only master can insert subscriptions"
  on public.subscriptions for insert
  to authenticated
  with check (private.is_platform_master());

create policy "only master can update subscriptions"
  on public.subscriptions for update
  to authenticated
  using (private.is_platform_master())
  with check (private.is_platform_master());
