-- Etapa 20.2.4 — auditoria de billing (Etapa 20.2.3 §11). Reaproveita
-- private.log_audit() (migrations 20260817220010/20260817220044), o
-- único caminho de escrita em audit_logs — nenhuma estrutura de
-- auditoria nova.
create function private.audit_billing_invoice_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'BILLING_INVOICE_CREATED', 'billing_invoice', new.id::text,
      null,
      jsonb_build_object('plan_id', new.plan_id, 'amount', new.amount, 'billing_cycle', new.billing_cycle, 'due_at', new.due_at)
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'PAID' then
    perform private.log_audit(
      new.tenant_id, 'BILLING_PAYMENT_CONFIRMED', 'billing_invoice', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status, 'paid_at', new.paid_at)
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'FAILED' then
    perform private.log_audit(
      new.tenant_id, 'BILLING_PAYMENT_FAILED', 'billing_invoice', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status, 'failure_reason', new.failure_reason)
    );
  end if;
  return new;
end;
$$;

create trigger audit_billing_invoice_changes
  after insert or update on public.billing_invoices
  for each row
  execute function private.audit_billing_invoice_changes();

-- Guarda de imutabilidade do histórico financeiro (Etapa 20.2.3 §2,
-- requisito explícito): uma vez que a invoice sai de PENDING,
-- amount/plan_id/plan_name_snapshot/period_start/period_end/
-- billing_cycle/subscription_id nunca mudam de novo — nem por bug, nem
-- por um MASTER editando plans.monthly_price depois (Etapa 20.2.2 §11).
-- tenant_id já é coberto à parte por prevent_tenant_id_change (migration
-- anterior). Não precisa de SECURITY DEFINER: só compara colunas da
-- própria linha, mesmo princípio de private.prevent_tenant_id_change().
create function private.prevent_billing_invoice_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'PENDING' and (
    new.amount is distinct from old.amount
    or new.plan_id is distinct from old.plan_id
    or new.plan_name_snapshot is distinct from old.plan_name_snapshot
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.billing_cycle is distinct from old.billing_cycle
    or new.subscription_id is distinct from old.subscription_id
  ) then
    raise exception
      'billing_invoices: amount/plan/period snapshot is immutable once the invoice leaves PENDING'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

create trigger prevent_billing_invoice_history_change
  before update on public.billing_invoices
  for each row
  execute function private.prevent_billing_invoice_history_change();

comment on function private.prevent_billing_invoice_history_change() is
  'Etapa 20.2.4 — bloqueia alterar o valor/plano/período de uma invoice já confirmada/falha/cancelada/reembolsada. Só status (PENDING→PAID/FAILED/CANCELLED, PAID→REFUNDED), paid_at, failed_at, failure_reason, raw_gateway_status, confirmed_by_event_id e last_gateway_event_at continuam alteráveis depois de PENDING — os dois últimos precisam seguir avançando conforme novos eventos legítimos do gateway chegam (ex.: um reembolso bem depois do pagamento), nunca fazem parte do "histórico financeiro" que esta guarda protege.';

-- Proteção contra evento fora de ordem (Etapa 20.2.4, correção pedida
-- explicitamente — substitui a ideia descartada de comparar contra
-- `updated_at`, que não é uma âncora confiável). `last_gateway_event_at`
-- só pode avançar, nunca retroceder — garantido no nível do banco, não
-- só na lógica de uma função de aplicação futura. Isso não decide POR SI
-- SÓ se um evento deve ser aplicado (essa decisão, "ignorar um evento
-- mais antigo que o já aplicado", é feita pela função que ainda vai ler
-- este campo antes de gravar um valor novo, numa etapa própria) — só
-- impede que qualquer caminho de escrita, mesmo um bug futuro, force o
-- campo para trás.
create function private.prevent_billing_invoice_event_regression()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.last_gateway_event_at is not null
     and new.last_gateway_event_at is not null
     and new.last_gateway_event_at < old.last_gateway_event_at
  then
    raise exception
      'billing_invoices: last_gateway_event_at cannot move backwards (stale/out-of-order gateway event)'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

create trigger prevent_billing_invoice_event_regression
  before update on public.billing_invoices
  for each row
  execute function private.prevent_billing_invoice_event_regression();

-- Estende o trigger já existente de subscriptions (migration
-- 20260817220057) para também emitir BILLING_SUBSCRIPTION_CANCELLED/
-- BILLING_SUBSCRIPTION_SUSPENDED — nomes DIFERENTES de TENANT_SUSPENDED/
-- TENANT_STATUS_CHANGED (migration 20260817220010, Etapa 18: LOJA
-- suspensa pelo MASTER), porque são conceitos diferentes (ASSINATURA
-- suspensa por inadimplência ≠ loja suspensa administrativamente).
-- TENANT_PLAN_CHANGED continua exatamente igual — mesmo texto, mesmos
-- eventos, nenhum comportamento existente alterado, nenhum evento
-- duplicado.
create or replace function private.audit_subscription_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'TENANT_PLAN_CHANGED', 'subscription', new.id::text,
      null, jsonb_build_object('plan_id', new.plan_id, 'status', new.status)
    );
    return new;
  end if;

  if old.plan_id is distinct from new.plan_id then
    perform private.log_audit(
      new.tenant_id, 'TENANT_PLAN_CHANGED', 'subscription', new.id::text,
      jsonb_build_object('plan_id', old.plan_id), jsonb_build_object('plan_id', new.plan_id)
    );
  end if;

  if old.status is distinct from new.status and new.status = 'cancelled' then
    perform private.log_audit(
      new.tenant_id, 'BILLING_SUBSCRIPTION_CANCELLED', 'subscription', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status)
    );
  elsif old.status is distinct from new.status and new.status = 'suspended' then
    perform private.log_audit(
      new.tenant_id, 'BILLING_SUBSCRIPTION_SUSPENDED', 'subscription', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status)
    );
  end if;

  return new;
end;
$$;
