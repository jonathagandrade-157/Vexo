-- Etapa 13 — update_order_status: único caminho para alterar
-- orders.status depois da criação do pedido. `authenticated`-only
-- (chamado só pelo painel, nunca pelo storefront) — nada de UPDATE
-- genérico liberado por RLS numa policy ampla: a máquina de estados é
-- uma regra de negócio, não uma checagem de posse de linha, então vive
-- dentro de uma função SECURITY DEFINER (mesmo padrão de
-- apply_shipping_to_order/apply_payment_update), que faz sua própria
-- checagem de permissão internamente em vez de depender de RLS para
-- autorizar a escrita.
create function public.update_order_status(
  p_tenant_id uuid,
  p_order_id uuid,
  p_new_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_allowed boolean;
begin
  select private.has_permission(p_tenant_id, 'orders.update') into v_allowed;
  if not (coalesce(v_allowed, false) or private.is_platform_admin()) then
    raise exception 'insufficient permission to update this order' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id and tenant_id = p_tenant_id;
  if v_order.id is null then
    raise exception 'order not found for this store' using errcode = 'P0002';
  end if;

  -- Máquina de estados explícita, exaustiva — nenhuma transição fora
  -- desta lista é aceita, nunca "qualquer status para qualquer status".
  -- payment_status (Etapa 11) não entra aqui: cancelar um pedido nunca
  -- dispara refund/estorno/cancelamento no gateway, é só o ciclo de
  -- vida comercial/operacional do pedido em si.
  if not (
    (v_order.status = 'PENDING' and p_new_status = 'CANCELLED')
    or (v_order.status = 'PAID' and p_new_status in ('PREPARING', 'CANCELLED'))
    or (v_order.status = 'PREPARING' and p_new_status in ('SHIPPED', 'CANCELLED'))
    or (v_order.status = 'SHIPPED' and p_new_status = 'DELIVERED')
  ) then
    raise exception 'invalid order status transition from % to %', v_order.status, p_new_status using errcode = 'P0001';
  end if;

  -- `and status = v_order.status` torna leitura-validação-escrita
  -- atômica (achado da revisão de segurança desta etapa): sem isto, duas
  -- chamadas concorrentes a partir do MESMO status de origem podiam
  -- validar independentemente (ex.: PREPARING → SHIPPED e PREPARING →
  -- CANCELLED, ambas válidas a partir de PREPARING) e a segunda escrita,
  -- destravada depois da primeira já ter avançado a linha, aplicava seu
  -- p_new_status por cima de um status que não era mais o validado —
  -- produzindo uma transição fora da máquina de estados (SHIPPED →
  -- CANCELLED no exemplo). Com a condição extra, se o status real da
  -- linha já não é mais v_order.status quando esta instrução roda,
  -- nenhuma linha corresponde e nada é escrito.
  update public.orders
  set status = p_new_status,
      internal_note = p_note
  where id = p_order_id and tenant_id = p_tenant_id and status = v_order.status;

  if not found then
    raise exception 'order status changed concurrently, please retry' using errcode = '40001';
  end if;
end;
$$;

comment on function public.update_order_status(uuid, uuid, text, text) is
  'Único caminho para avançar orders.status depois da criação do pedido — valida a transição numa máquina de estados exaustiva no servidor, nunca confia num status vindo do cliente. Nunca altera payment_status nem dispara nenhuma operação financeira externa.';

revoke execute on function public.update_order_status(uuid, uuid, text, text)
  from public, anon, service_role;
grant execute on function public.update_order_status(uuid, uuid, text, text) to authenticated;

-- Auditoria automática (trigger), mesmo princípio já usado para
-- ORDER_CREATED (Etapa 10) — "estruturalmente acoplado à mutação", não
-- uma chamada manual dentro da função acima (assim nenhuma escrita
-- futura em orders.status escapa do log, mesmo que não passe por
-- update_order_status). `new.internal_note` é exatamente a nota desta
-- transição (a função acima sempre grava as duas colunas na mesma
-- instrução), nunca uma nota antiga sendo reatribuída a um evento novo.
create function private.audit_order_status_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform private.log_audit(
      new.tenant_id, 'ORDER_STATUS_CHANGED', 'order', new.id::text,
      jsonb_build_object('status', old.status),
      case
        when new.internal_note is not null then jsonb_build_object('status', new.status, 'note', new.internal_note)
        else jsonb_build_object('status', new.status)
      end
    );
  end if;
  return new;
end;
$$;

create trigger audit_order_status_changed
  after update on public.orders
  for each row
  execute function private.audit_order_status_changed();
