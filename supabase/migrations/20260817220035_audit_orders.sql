-- Etapa 10 — auditoria de pedidos.
--
-- private.log_audit() (Etapa 2) rejeita logar um evento para um tenant
-- quando o ator não é membro/platform admin/service_role — correto para
-- todo evento até agora (sempre iniciado por staff autenticado). Mas o
-- checkout desta etapa é 100% anônimo (mesmo modelo do carrinho, Etapa
-- 9): sem essa exceção, ORDER_CREATED derrubaria a transação inteira de
-- criação do pedido (a guarda levantaria exceção dentro da própria
-- função create_order_from_cart). Adiciona UMA exceção estreita, no
-- mesmo padrão já usado para TENANT_CREATED (comentário original: "quem
-- acabou de criar o tenant ainda não é membro dele") — escopada a essa
-- única action, e só quando o tenant é de fato um tenant publicado (não
-- suspenso/excluído), nunca um "acesso liberado" genérico. Não
-- enfraquece a guarda para nenhum outro evento/action existente.
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
         p_action = 'ORDER_CREATED'
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

-- Automático (trigger), não uma chamada manual dentro de
-- create_order_from_cart — mesmo princípio "estruturalmente acoplado à
-- mutação" já usado para tenants/categories/products. Payload mínimo de
-- propósito (§17: "registrar somente informações necessárias") — nunca
-- nome/e-mail/telefone/endereço do cliente no log de auditoria.
create function private.audit_order_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_audit(
    new.tenant_id, 'ORDER_CREATED', 'order', new.id::text,
    null, jsonb_build_object('order_number', new.order_number, 'total', new.total, 'status', new.status)
  );
  return new;
end;
$$;

create trigger audit_order_created
  after insert on public.orders
  for each row
  execute function private.audit_order_created();
