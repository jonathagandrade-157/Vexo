-- Etapa 11 — metadado público da conexão de pagamento do lojista
-- (arquitetura §11/§5.4) — nunca guarda segredo, é isso que a UI lê
-- para mostrar "Mercado Pago conectado ✅". Segredo de verdade vai em
-- payment_credentials_vault (próxima migration).
create table public.store_payment_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  provider text not null check (provider in ('mercadopago')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected')),
  connected_account_id text,
  connected_account_email text,
  live_mode boolean,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Um tenant só tem uma conexão por provedor (nunca duas linhas
  -- concorrentes para o mesmo provider — prompt §6: "evitar conexão
  -- duplicada").
  constraint store_payment_providers_tenant_provider_unique unique (tenant_id, provider)
);

create index store_payment_providers_tenant_id_idx on public.store_payment_providers (tenant_id);

alter table public.store_payment_providers enable row level security;
alter table public.store_payment_providers force row level security;

create trigger set_updated_at before update on public.store_payment_providers
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_id_change before update on public.store_payment_providers
  for each row execute function private.prevent_tenant_id_change();

-- RLS: staff da própria loja gerencia via payments.manage/vê via
-- payments.view (permissões já criadas na migration anterior). Sem
-- policy para `anon` — este metadado só é lido pelo checkout através de
-- uma função (próxima etapa de migrations), nunca por leitura direta,
-- para não vazar `connected_account_id`/`live_mode` de qualquer tenant
-- publicado (não é segredo, mas também não é dado que precise ser
-- público).
create policy "tenant staff with payments.view can select payment providers"
  on public.store_payment_providers for select
  to authenticated
  using (private.has_permission(tenant_id, 'payments.view') or private.is_platform_admin());

create policy "tenant staff with payments.manage can insert payment providers"
  on public.store_payment_providers for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'payments.manage'));

create policy "tenant staff with payments.manage can update payment providers"
  on public.store_payment_providers for update
  to authenticated
  using (private.has_permission(tenant_id, 'payments.manage'))
  with check (private.has_permission(tenant_id, 'payments.manage'));
