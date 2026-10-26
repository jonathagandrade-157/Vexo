-- Etapa 20.2.6 — RPCs de suporte ao fluxo de 1ª assinatura de billing
-- (features/billing/start-subscription.ts). A Etapa 20.2.4 deixou
-- `billing_invoices` e o UPDATE de `subscriptions.gateway_*` sem NENHUMA
-- policy de escrita para `authenticated` de propósito ("toda escrita
-- real... será feita por função(ões) SECURITY DEFINER futuras") — estas
-- são exatamente essas funções.
--
-- CORREÇÃO em relação ao relatório anterior da Etapa 20.2.6: a permissão
-- `billing.manage` NÃO precisa ser criada — ela já existe desde a Etapa 2
-- (migration 20260817220003_roles_and_permissions.sql), já mapeada para
-- OWNER. Confirmado consultando diretamente `public.permissions`/
-- `public.role_permissions` em produção antes de escrever este arquivo.
-- Esta migration usa essa permissão já existente, sem recriá-la.
--
-- Nenhuma RLS é alterada: as duas funções são SECURITY DEFINER (rodam
-- como o dono, ignorando RLS por construção, mesmo padrão de
-- `create_payment_for_order`/`update_tenant_status`) — a autorização real
-- vive dentro do corpo de cada função, não em uma policy nova.

-- Só altera gateway/gateway_customer_id/gateway_subscription_id/
-- payment_method — nunca tenant_id (imutável por
-- `prevent_tenant_id_change`, intocado), nunca plan_id/status/
-- billing_cycle/trial_start/trial_end/current_period_start/
-- current_period_end/cancelled_at (só a confirmação de webhook, etapa
-- futura, deve tocar esses campos).
create function public.set_billing_gateway_identifiers(
  p_tenant_id uuid,
  p_gateway text,
  p_gateway_customer_id text,
  p_gateway_subscription_id text,
  p_payment_method text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not private.is_tenant_member(p_tenant_id) then
    raise exception 'not a member of this tenant' using errcode = '42501';
  end if;
  if not private.has_permission(p_tenant_id, 'billing.manage') then
    raise exception 'missing billing.manage permission for this tenant' using errcode = '42501';
  end if;

  update public.subscriptions
  set gateway = p_gateway,
      gateway_customer_id = p_gateway_customer_id,
      gateway_subscription_id = p_gateway_subscription_id,
      payment_method = p_payment_method
  where tenant_id = p_tenant_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'no subscription row for this tenant' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.set_billing_gateway_identifiers(uuid, text, text, text, text) is
  'Etapa 20.2.6 — grava os identificadores do gateway de billing em subscriptions (SOMENTE gateway/gateway_customer_id/gateway_subscription_id/payment_method). Nunca toca plan_id/status/billing_cycle/período/trial/cancelled_at — isso é reservado à confirmação de webhook (etapa futura). MASTER não tem acesso especial aqui (só quem é membro do tenant com billing.manage).';

revoke execute on function public.set_billing_gateway_identifiers(uuid, text, text, text, text) from public, anon, service_role;
grant execute on function public.set_billing_gateway_identifiers(uuid, text, text, text, text) to authenticated;

-- Cria a 1ª billing_invoices do tenant, sempre PENDING (não existe
-- parâmetro de status — não há como esta função marcar uma invoice como
-- PAID/FAILED, por construção). plan_name_snapshot é relido de
-- public.plans pelo próprio banco, nunca aceito de um parâmetro do
-- chamador (nunca confia num texto vindo da aplicação para o snapshot
-- histórico, Etapa 20.2.2 §11).
create function public.create_billing_invoice(
  p_tenant_id uuid,
  p_gateway text,
  p_gateway_invoice_id text,
  p_plan_id uuid,
  p_amount numeric,
  p_billing_cycle text,
  p_payment_method text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_due_at timestamptz
)
returns public.billing_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription_id uuid;
  v_plan_name text;
  v_row public.billing_invoices;
begin
  if not private.is_tenant_member(p_tenant_id) then
    raise exception 'not a member of this tenant' using errcode = '42501';
  end if;
  if not private.has_permission(p_tenant_id, 'billing.manage') then
    raise exception 'missing billing.manage permission for this tenant' using errcode = '42501';
  end if;

  select id into v_subscription_id from public.subscriptions where tenant_id = p_tenant_id;
  if v_subscription_id is null then
    raise exception 'no subscription row for this tenant' using errcode = 'P0002';
  end if;

  select name into v_plan_name from public.plans where id = p_plan_id;
  if v_plan_name is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;

  insert into public.billing_invoices (
    tenant_id, subscription_id, gateway, gateway_invoice_id, plan_id, plan_name_snapshot,
    amount, billing_cycle, status, payment_method, period_start, period_end, due_at
  ) values (
    p_tenant_id, v_subscription_id, p_gateway, p_gateway_invoice_id, p_plan_id, v_plan_name,
    p_amount, p_billing_cycle, 'PENDING', p_payment_method, p_period_start, p_period_end, p_due_at
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_billing_invoice(uuid, text, text, uuid, numeric, text, text, timestamptz, timestamptz, timestamptz) is
  'Etapa 20.2.6 — cria a billing_invoices de uma tentativa de assinatura, sempre PENDING (sem parâmetro de status — nunca pode marcar PAID/FAILED). plan_name_snapshot é relido de public.plans pelo próprio banco, nunca confiado do chamador. Respeita os CHECKs/UNIQUE já existentes de billing_invoices (Etapa 20.2.4) sem alterá-los.';

revoke execute on function public.create_billing_invoice(uuid, text, text, uuid, numeric, text, text, timestamptz, timestamptz, timestamptz) from public, anon, service_role;
grant execute on function public.create_billing_invoice(uuid, text, text, uuid, numeric, text, text, timestamptz, timestamptz, timestamptz) to authenticated;
