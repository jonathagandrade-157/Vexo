-- Etapa 20.2.4 — Billing do VEXO: campos de gateway em subscriptions
-- (decisão A da Etapa 20.2.3 §1 — 1:1 com tenant_id, mesma cardinalidade
-- já imposta pela UNIQUE(tenant_id) existente desde a Etapa 14, migration
-- 20260817220054). Todos nullable: um tenant só em trial, sem nenhuma
-- relação de billing ainda, continua funcionando exatamente como hoje —
-- tenant_access_status()/tenant_has_feature()/tenant_plan_limit()
-- (migrations 20260817220055/20260817220059/20260817220066) não leem
-- nenhuma destas colunas, então nenhuma delas muda de comportamento.
--
-- tenant_id, plan_id e status NÃO são tocados nesta migration (exigência
-- explícita da Etapa 20.2.4).
--
-- Correção aplicada nesta etapa: `gateway` NÃO fica travado em 'asaas'.
-- Asaas é o primeiro provider implementado, mas a lista do CHECK já
-- inclui os concorrentes mais prováveis de entrar depois — adicionar um
-- novo é uma migration puramente aditiva (troca só a lista do CHECK,
-- nunca a coluna em si, nunca dado existente).
alter table public.subscriptions
  add column gateway text,
  add column gateway_customer_id text,
  add column gateway_subscription_id text,
  add column pending_plan_id uuid references public.plans (id),
  add column payment_method text;

alter table public.subscriptions
  add constraint subscriptions_gateway_check
    check (gateway is null or gateway in ('asaas', 'stripe', 'iugu', 'pagarme', 'pagbank'));

alter table public.subscriptions
  add constraint subscriptions_payment_method_check
    check (payment_method is null or payment_method in ('pix', 'card'));

comment on column public.subscriptions.gateway is
  'Provider de BILLING (VEXO cobrando o lojista) responsável por esta assinatura — nunca o Mercado Pago da loja (payments/store_payment_providers, contexto inteiramente separado, Etapa 20.2.1 §2). NULL enquanto o tenant nunca teve nenhuma relação de billing real (trial puro).';
comment on column public.subscriptions.gateway_customer_id is
  'Id do Customer no gateway de billing. Nunca um segredo — mesma sensibilidade de store_payment_providers.connected_account_id — por isso pode ficar sob a RLS já existente de subscriptions, sem precisar do isolamento de payment_credentials_vault.';
comment on column public.subscriptions.gateway_subscription_id is
  'Id da assinatura recorrente no gateway de billing. UNIQUE parcial (subscriptions_gateway_subscription_unique) impede duas linhas apontarem para a mesma assinatura externa.';
comment on column public.subscriptions.pending_plan_id is
  'Plano de destino de um downgrade já pedido mas ainda não efetivado (Etapa 20.2.3 §7) — plan_id só muda no próximo ciclo. NULL = nenhum downgrade pendente.';
comment on column public.subscriptions.payment_method is
  'Forma de pagamento da assinatura de BILLING (V1: pix ou card) — não confundir com payments.method, que é do pagamento do CLIENTE FINAL na loja.';

-- Busca do tenant a partir de um id do gateway (webhook nunca confia em
-- tenant_id solto do payload — Etapa 20.2.3 §4).
create index subscriptions_gateway_customer_id_idx
  on public.subscriptions (gateway_customer_id)
  where gateway_customer_id is not null;

create index subscriptions_gateway_subscription_id_idx
  on public.subscriptions (gateway_subscription_id)
  where gateway_subscription_id is not null;

create index subscriptions_pending_plan_id_idx
  on public.subscriptions (pending_plan_id)
  where pending_plan_id is not null;

-- Nunca duas subscriptions locais apontando para a mesma assinatura
-- externa do mesmo gateway.
create unique index subscriptions_gateway_subscription_unique
  on public.subscriptions (gateway, gateway_subscription_id)
  where gateway_subscription_id is not null;
