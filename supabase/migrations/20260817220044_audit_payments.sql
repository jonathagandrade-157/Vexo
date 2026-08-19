-- Etapa 11 — auditoria de pagamentos (prompt §15). Estende a mesma
-- exceção estreita de log_audit já criada na Etapa 10 para
-- ORDER_CREATED — PAYMENT_CREATED também é disparado por um ator anônimo
-- (create_payment_for_order, chamada pelo checkout como `anon`, mesmo
-- modelo do resto do carrinho/pedido). PAYMENT_APPROVED/REJECTED/
-- CANCELLED/REFUNDED vêm de apply_payment_update, chamada como
-- `service_role` pelo webhook — já passam pela guarda existente sem
-- exceção nenhuma. PAYMENT_CONNECTION_CREATED/REMOVED vêm de uma sessão
-- de staff autenticada de verdade — idem.
create or replace function private.log_audit(
  p_tenant_id uuid,
  p_action text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_actor_type text;
  v_id uuid;
begin
  v_actor_user_id := auth.uid();

  if private.is_platform_admin() then
    v_actor_type := 'master';
  elsif v_actor_user_id is not null then
    v_actor_type := 'user';
  else
    v_actor_type := 'system';
  end if;

  if p_tenant_id is not null
     and auth.role() is distinct from 'service_role'
     and not (
       private.is_platform_admin()
       or private.is_tenant_member(p_tenant_id)
       or exists (
         select 1 from public.tenants t
         where t.id = p_tenant_id and t.created_by = auth.uid()
       )
       or (
         p_action in ('ORDER_CREATED', 'PAYMENT_CREATED')
         and exists (select 1 from public.tenants t where t.id = p_tenant_id and t.status not in ('suspended', 'deleted'))
       )
     )
  then
    raise exception
      'log_audit: caller is not authorized to log an event for tenant %',
      p_tenant_id
      using errcode = '42501'; -- insufficient_privilege
  end if;

  insert into public.audit_logs (
    tenant_id, actor_user_id, actor_type, action,
    resource_type, resource_id, before, after, reason, metadata
  ) values (
    p_tenant_id, v_actor_user_id, v_actor_type, p_action,
    p_resource_type, p_resource_id, p_before, p_after, p_reason, p_metadata
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- store_payment_providers: nunca token/segredo, só metadado (arquitetura
-- §11.1: "provider + identificador mascarado da conta conectada, nunca o
-- token"). connected_account_id é mascarado (só os últimos 4
-- caracteres) mesmo não sendo segredo — é um identificador de conta de
-- terceiro, tratado com cautela extra.
create function private.mask_account_id(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when length(p_value) <= 4 then repeat('*', length(p_value))
    else repeat('*', length(p_value) - 4) || right(p_value, 4)
  end;
$$;

create function private.audit_payment_provider_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'connected') then
    perform private.log_audit(
      new.tenant_id, 'PAYMENT_CONNECTION_CREATED', 'payment_provider', new.id::text,
      null, jsonb_build_object('provider', new.provider, 'connected_account_id', private.mask_account_id(new.connected_account_id))
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'disconnected' then
    perform private.log_audit(
      new.tenant_id, 'PAYMENT_CONNECTION_REMOVED', 'payment_provider', new.id::text,
      jsonb_build_object('provider', old.provider), null
    );
  end if;
  return new;
end;
$$;

create trigger audit_payment_provider_changes
  after insert or update on public.store_payment_providers
  for each row
  execute function private.audit_payment_provider_changes();

create function private.audit_payment_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'PAYMENT_CREATED', 'payment', new.id::text,
      null, jsonb_build_object('order_id', new.order_id, 'provider', new.provider, 'amount', new.amount)
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform private.log_audit(
      new.tenant_id,
      case new.status
        when 'APPROVED' then 'PAYMENT_APPROVED'
        when 'REJECTED' then 'PAYMENT_REJECTED'
        when 'CANCELLED' then 'PAYMENT_CANCELLED'
        when 'REFUNDED' then 'PAYMENT_REFUNDED'
        else 'PAYMENT_UPDATED'
      end,
      'payment', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger audit_payment_changes
  after insert or update on public.payments
  for each row
  execute function private.audit_payment_changes();
