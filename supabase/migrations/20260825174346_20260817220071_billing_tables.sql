-- Etapa 20.2.4 — billing_webhook_events + billing_invoices (Etapa 20.2.3
-- §2/§3). Nunca reaproveita payments/payment_webhook_events (contexto do
-- CLIENTE FINAL pagando a LOJA, Etapa 11) nem payment_credentials_vault
-- (Etapa 20.2.1 §2/§6: OAuth Connect do lojista, produto errado para
-- cobrar o próprio lojista). `provider`/`gateway` aceitam múltiplos
-- providers desde já — mesma correção da migration anterior.

-- billing_webhook_events primeiro: billing_invoices referencia
-- confirmed_by_event_id nesta tabela.
create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('asaas', 'stripe', 'iugu', 'pagarme', 'pagbank')),
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  constraint billing_webhook_events_provider_event_unique unique (provider, event_id)
);

comment on table public.billing_webhook_events is
  'Idempotência de webhook de BILLING (assinatura do lojista com a VEXO) — nunca confundir com payment_webhook_events (pagamento do cliente final na loja, Etapa 11, migration 20260817220040). Mesmo mecanismo de idempotência: UNIQUE(provider, event_id).';
comment on column public.billing_webhook_events.attempts is
  'Incrementado a cada tentativa de processamento (novo em relação a payment_webhook_events) — permite detectar um evento travado precisando de atenção manual.';

create index billing_webhook_events_received_at_idx on public.billing_webhook_events (received_at);
create index billing_webhook_events_unprocessed_idx
  on public.billing_webhook_events (received_at)
  where processed_at is null;

-- billing_invoices: histórico financeiro real (Etapa 20.2.3 §2). O valor
-- histórico (amount/plan_id/plan_name_snapshot/period_start/period_end/
-- billing_cycle) nunca é recalculado a partir de plans.monthly_price —
-- ver o trigger de imutabilidade na migration seguinte (Etapa 20.2.2
-- §11, requisito explícito desta etapa).
create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  subscription_id uuid not null references public.subscriptions (id),
  gateway text not null check (gateway in ('asaas', 'stripe', 'iugu', 'pagarme', 'pagbank')),
  -- NULL até a criação ser confirmada no gateway (mesmo padrão de
  -- payments.external_id, migration 20260817220040) — nunca um id
  -- gerado pelo VEXO, sempre o que o gateway devolveu.
  gateway_invoice_id text,
  plan_id uuid not null references public.plans (id),
  plan_name_snapshot text not null,
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED')),
  -- Status bruto do gateway, sem tradução — só suporte/debug/
  -- reconciliação, nunca usado por nenhuma lógica de autorização/acesso.
  raw_gateway_status text,
  payment_method text check (payment_method is null or payment_method in ('pix', 'card')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  due_at timestamptz not null,
  paid_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  confirmed_by_event_id uuid references public.billing_webhook_events (id),
  -- Timestamp do EVENTO no gateway (não de quando o VEXO recebeu/tocou a
  -- linha) — âncora real para decidir se um webhook é mais novo do que o
  -- último já aplicado. Nunca comparar contra `updated_at`: `updated_at`
  -- muda por qualquer toque na linha (inclusive uma correção manual de
  -- suporte em `raw_gateway_status`), então não é uma prova confiável de
  -- "qual evento do gateway já foi aplicado por último". A função que vai
  -- decidir aplicar ou descartar um evento (etapa futura, junto da
  -- integração real com o Asaas) compara o timestamp do NOVO evento
  -- contra este campo — só avança, nunca aplica um evento mais antigo. O
  -- trigger prevent_billing_invoice_event_regression (migration seguinte)
  -- garante isso no nível do banco, não só na lógica de aplicação.
  last_gateway_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_invoices is
  'Histórico financeiro real de BILLING (uma linha por cobrança de ciclo) — subscriptions continua sendo só "estado atual", nunca duplicando isto. amount/plan_id/plan_name_snapshot/period_* são imutáveis depois de sair de PENDING (ver trigger prevent_billing_invoice_history_change, migration seguinte) — preço histórico nunca muda porque o MASTER editou plans.monthly_price depois (Etapa 20.2.2 §11).';
comment on column public.billing_invoices.plan_name_snapshot is
  'Cópia literal de plans.name no momento da cobrança — nunca relida de plans depois, mesmo que o plano seja renomeado.';

create index billing_invoices_tenant_id_idx on public.billing_invoices (tenant_id);
create index billing_invoices_subscription_id_idx on public.billing_invoices (subscription_id);
create index billing_invoices_status_idx on public.billing_invoices (status);
create index billing_invoices_due_at_idx on public.billing_invoices (due_at);
create index billing_invoices_gateway_invoice_id_idx
  on public.billing_invoices (gateway_invoice_id)
  where gateway_invoice_id is not null;

-- Nunca duas linhas locais para a mesma cobrança externa — proteção
-- direta contra registrar/cobrar em duplicidade (Etapa 20.2.3 §15).
create unique index billing_invoices_gateway_invoice_unique
  on public.billing_invoices (gateway, gateway_invoice_id)
  where gateway_invoice_id is not null;

alter table public.billing_invoices enable row level security;
alter table public.billing_invoices force row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.billing_webhook_events force row level security;

create trigger set_updated_at before update on public.billing_invoices
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_id_change before update on public.billing_invoices
  for each row execute function private.prevent_tenant_id_change();

-- billing_invoices: leitura do próprio tenant (membro ativo — a permissão
-- fina, ex. "billing.view", fica para a etapa de implementação da UI,
-- Etapa 20.2.8) + qualquer platform admin (MASTER e SUPPORT_AGENT — dado
-- financeiro DO LOJISTA, mesma sensibilidade de payments, não segredo de
-- terceiro). Sem NENHUMA policy de INSERT/UPDATE/DELETE: nem OWNER nem
-- SUPPORT_AGENT escrevem aqui diretamente — toda escrita real (criar a
-- 1ª invoice, aplicar o resultado de um webhook) será feita por função(ões)
-- SECURITY DEFINER desenhadas numa etapa própria, junto da integração real
-- com o Asaas (fora do escopo desta migration — nenhuma RPC de billing é
-- criada aqui).
create policy "tenant staff and platform admins can select billing invoices"
  on public.billing_invoices for select
  to authenticated
  using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

-- billing_webhook_events: só MASTER lê (payload bruto de cobrança é mais
-- sensível do que o necessário para SUPPORT_AGENT — decisão deliberada,
-- Etapa 20.2.3 §10, diferente do zero-policy de payment_webhook_events,
-- migration 20260817220040; aqui abrimos exatamente uma leitura a mais
-- para suporte/reconciliação, nunca mais). Sem NENHUMA policy de
-- INSERT/UPDATE/DELETE: escrita só pelo Route Handler do webhook,
-- autenticado como service_role (mesmo padrão exato de
-- payment_webhook_events).
create policy "only master can select billing webhook events"
  on public.billing_webhook_events for select
  to authenticated
  using (private.is_platform_master());

-- A ALTER DEFAULT PRIVILEGES da migration 20260817220067 concede
-- select/insert/update/delete a anon/authenticated/service_role em toda
-- tabela NOVA por padrão — exatamente o problema que aquela migration
-- corrigiu para o futuro. Sem revogar explicitamente aqui,
-- billing_invoices/billing_webhook_events nasceriam com privilégio de
-- escrita direta para authenticated/anon, contradizendo "toda escrita
-- financeira passa pela camada segura" (Etapa 20.2.4 §4/§11). Revoga
-- tudo primeiro, concede só o que cada papel realmente precisa — mesmo
-- padrão defensivo já usado para trial_eligibility (migration
-- 20260817220016).
revoke all on public.billing_invoices from anon, authenticated, service_role;
revoke all on public.billing_webhook_events from anon, authenticated, service_role;

grant select on public.billing_invoices to authenticated;
grant select on public.billing_webhook_events to authenticated;

-- Mesmo padrão exato de payment_webhook_events (migration
-- 20260817220067): o Route Handler do webhook grava aqui diretamente
-- como service_role (BYPASSRLS) — a idempotência vem do
-- UNIQUE(provider, event_id), nunca de RLS.
grant select, insert, update on public.billing_webhook_events to service_role;

-- billing_invoices NÃO recebe nenhum grant de escrita para nenhum papel
-- nesta migration: a criação da 1ª invoice e a confirmação de pagamento
-- só poderão escrever através de função(ões) SECURITY DEFINER futuras,
-- cujo dono (postgres) não depende de GRANT de tabela para o papel que
-- as invoca. Nenhuma RPC de billing é criada por esta migration — fica
-- para uma etapa própria, junto da integração real com o Asaas.
