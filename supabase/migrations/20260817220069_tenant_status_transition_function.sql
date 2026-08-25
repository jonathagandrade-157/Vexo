-- Etapa 18 — public.update_tenant_status: único caminho para MASTER
-- (nunca SUPPORT_AGENT, nunca o próprio lojista) avançar tenants.status
-- por uma máquina de estados explícita. Mesmo padrão de
-- public.update_order_status (migration 20260817220051): SECURITY
-- DEFINER, tabela de transições exaustiva, UPDATE atômico condicionado
-- ao status lido (evita corrida de concorrência).
--
-- A RLS/trigger de tenants (migration 20260817220012) continuam como
-- segunda camada de defesa — esta função só adiciona a restrição a
-- MASTER (mais estrita que "qualquer platform admin", que o trigger já
-- impõe) e a validação de transição, nunca substitui a autorização de
-- base: mesmo que esta função tivesse um bug, o trigger
-- prevent_unauthorized_tenant_status_change ainda bloqueia qualquer
-- não-admin de mudar tenants.status por fora dela.
--
-- Auditoria automática: o trigger audit_tenant_changes (migration
-- 20260817220010) já dispara em qualquer UPDATE de tenants.status e
-- grava TENANT_SUSPENDED/TENANT_STATUS_CHANGED via private.log_audit() —
-- esta função não chama log_audit diretamente, só faz o UPDATE.
create function public.update_tenant_status(
  p_tenant_id uuid,
  p_new_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
begin
  if not private.is_platform_master() then
    raise exception 'only a MASTER admin can change a store status' using errcode = '42501';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if v_tenant.id is null then
    raise exception 'store not found' using errcode = 'P0002';
  end if;

  -- Máquina de estados explícita, exaustiva — nenhuma transição fora
  -- desta lista é aceita (nunca 'deleted', nunca pular etapas).
  if not (
    (v_tenant.status = 'pending' and p_new_status = 'active')
    or (v_tenant.status = 'active' and p_new_status = 'suspended')
    or (v_tenant.status = 'suspended' and p_new_status = 'active')
  ) then
    raise exception 'invalid tenant status transition from % to %', v_tenant.status, p_new_status using errcode = 'P0001';
  end if;

  -- `and status = v_tenant.status` torna leitura-validação-escrita
  -- atômica (mesmo achado de segurança já aplicado a
  -- update_order_status): sem isto, duas chamadas concorrentes a partir
  -- do MESMO status de origem podiam validar independentemente e uma
  -- delas aplicar seu p_new_status por cima de um status que já não era
  -- mais o validado.
  update public.tenants
  set status = p_new_status
  where id = p_tenant_id and status = v_tenant.status;

  if not found then
    raise exception 'tenant status changed concurrently, please retry' using errcode = '40001';
  end if;
end;
$$;

comment on function public.update_tenant_status(uuid, text) is
  'Único caminho para MASTER avançar tenants.status (pending→active, active→suspended, suspended→active). Nunca chamável por SUPPORT_AGENT nem pelo próprio lojista — a RLS/trigger de tenants continuam como segunda camada. Auditoria automática via o trigger audit_tenant_changes já existente.';

revoke execute on function public.update_tenant_status(uuid, text)
  from public, anon, service_role;
grant execute on function public.update_tenant_status(uuid, text) to authenticated;
