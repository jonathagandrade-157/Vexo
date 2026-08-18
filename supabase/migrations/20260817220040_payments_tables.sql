-- Etapa 11 — payments (pagamento do cliente final para a loja,
-- arquitetura §5.4/§15 — não confundir com a futura assinatura do
-- lojista para a VEXO, que usará outras tabelas) + payment_webhook_events
-- (idempotência de webhook, arquitetura §12.1).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  -- Uma linha por pedido (não um histórico de tentativas nesta etapa,
  -- decisão documentada no relatório final) — uma nova tentativa de
  -- pagamento para o mesmo pedido atualiza esta mesma linha via upsert,
  -- nunca cria uma segunda (é a própria garantia estrutural de "não
  -- duplicar pagamento").
  order_id uuid not null references public.orders (id) unique,
  provider text not null check (provider in ('mercadopago')),
  -- Id do pagamento no provedor quando conhecido (só depois que o
  -- cliente efetivamente paga) — nulo enquanto só existe a preference.
  external_id text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED')),
  -- Sempre copiado de orders.total no momento da criação (nunca um
  -- valor vindo do cliente) — prompt §12.
  amount numeric(10, 2) not null check (amount >= 0),
  method text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_tenant_id_idx on public.payments (tenant_id);

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('mercadopago')),
  event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_webhook_events_provider_event_unique unique (provider, event_id)
);

alter table public.payments enable row level security;
alter table public.payments force row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.payment_webhook_events force row level security;

create trigger set_updated_at before update on public.payments
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_id_change before update on public.payments
  for each row execute function private.prevent_tenant_id_change();

-- Staff só lê (mesmo padrão de orders/order_items, Etapa 10) — escrita
-- só pelas funções RPC (próxima migration, anon-only para o checkout,
-- service_role-only para o webhook). Sem policy nenhuma para
-- payment_webhook_events: é puramente interno (idempotência de
-- infraestrutura), nenhuma UI lê isso.
create policy "tenant staff with payments.view can select payments"
  on public.payments for select
  to authenticated
  using (private.has_permission(tenant_id, 'payments.view') or private.is_platform_admin());
