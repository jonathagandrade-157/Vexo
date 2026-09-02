-- D14.1 — notificação interna de novo pedido para o lojista. Nenhum
-- sistema de notificação existia antes (auditoria D14.0: busca exaustiva
-- por e-mail/push/realtime/badge/contador não encontrou nada em todo o
-- repositório). Nasce de um evento real de criação de pedido, via
-- trigger AFTER INSERT em `orders` — nunca do navegador do cliente,
-- nunca como efeito colateral de renderizar o painel (que só LÊ
-- notificações já existentes). Um INSERT em `orders` dispara o trigger
-- exatamente uma vez, então "uma notificação por pedido" é garantido
-- estruturalmente pelo próprio mecanismo de trigger, não por uma
-- checagem de idempotência aplicada depois.
--
-- `resource_type`/`resource_id` como `text` livre (sem FK), espelhando
-- deliberadamente o mesmo padrão já usado por `audit_logs`
-- (`resource_type text`, `resource_id text`, migration
-- 20260817220007) — arquitetura já existente reaproveitada, nunca uma
-- nova inventada. Único `type` hoje é `new_order`; o CHECK torna
-- explícito que outros tipos exigem uma migration nova para o vocabulário
-- crescer, nunca um valor solto aceito silenciosamente.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  type text not null check (type in ('new_order')),
  title text not null,
  message text not null,
  resource_type text not null,
  resource_id text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'Notificações internas do painel do lojista (D14.1) — hoje só "new_order", criada automaticamente pelo trigger notify_new_order em orders. Nunca inserida diretamente por authenticated/anon; a única escrita da aplicação é marcar read_at.';

create index notifications_tenant_id_created_at_idx on public.notifications (tenant_id, created_at desc);
create index notifications_tenant_id_unread_idx on public.notifications (tenant_id) where read_at is null;

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- Mesma permission key já usada para `orders` (migration
-- 20260817220034) — ver uma notificação de pedido novo exige a mesma
-- permissão de ver o próprio pedido; nenhuma permission key nova é
-- criada.
create policy "tenant staff with orders.view can select notifications"
  on public.notifications for select
  to authenticated
  using (private.has_permission(tenant_id, 'orders.view') or private.is_platform_admin());

-- Marcar como lida é a única escrita que a aplicação pode fazer (nunca
-- title/message/tenant_id/type/resource_*) — a policy sozinha já limita
-- QUEM pode fazer UPDATE; o trigger abaixo limita O QUE pode mudar,
-- defesa em profundidade contra um UPDATE que tentasse alterar mais que
-- `read_at` (ex.: uma chamada direta ao PostgREST fora do caminho da
-- aplicação).
create policy "tenant staff with orders.view can mark notifications read"
  on public.notifications for update
  to authenticated
  using (private.has_permission(tenant_id, 'orders.view'))
  with check (private.has_permission(tenant_id, 'orders.view'));

create function private.prevent_notification_content_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.type is distinct from old.type
     or new.title is distinct from old.title
     or new.message is distinct from old.message
     or new.resource_type is distinct from old.resource_type
     or new.resource_id is distinct from old.resource_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'notifications: only read_at can be updated' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger prevent_notification_content_change
  before update on public.notifications
  for each row
  execute function private.prevent_notification_content_change();

-- Fonte única do evento "novo pedido" (prompt D14.1 §9/§10/§11): dispara
-- depois que `create_order_from_cart` insere a linha em `orders`,
-- cobrindo os dois caminhos que criam pedido (checkout online e
-- WhatsApp/fallback) sem duplicar lógica em nenhuma Server Action —
-- nenhuma delas precisa saber que notificações existem. AFTER INSERT
-- garante exatamente uma notificação por pedido; nunca dispara em
-- UPDATE (uma mudança de status não gera uma segunda notificação "novo
-- pedido"). `message` já traz o essencial (número do pedido + nome do
-- cliente) para a notificação ser útil sozinha, sem exigir um segundo
-- join só para ser legível — o valor total, quando necessário na UI, é
-- lido de `orders.total` (fonte única, nunca duplicado/reformatado aqui
-- dentro de uma migration).
create function private.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (tenant_id, type, title, message, resource_type, resource_id)
  values (
    new.tenant_id,
    'new_order',
    'Novo pedido',
    'Pedido #' || new.order_number || ' de ' || new.customer_name,
    'order',
    new.id::text
  );
  return new;
end;
$$;

create trigger notify_new_order
  after insert on public.orders
  for each row
  execute function private.notify_new_order();
