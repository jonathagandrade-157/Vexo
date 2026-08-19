-- Etapa 11 — vault de credenciais de pagamento (arquitetura §11.1).
--
-- Guarda REFERÊNCIAS a segredos no Supabase Vault (`vault.secrets`,
-- extensão pgsodium nativa do Supabase), não texto cifrado por conta
-- própria: `vault.create_secret()`/`vault.decrypted_secrets` já
-- implementam envelope encryption de verdade (o Supabase gerencia a
-- chave mestra) — reimplementar AES-GCM à mão aqui seria duplicar o que
-- o próprio §11.1 recomenda usar. Nenhum access_token/refresh_token em
-- texto puro nesta tabela, nunca.
--
-- IMPORTANTE (ver relatório final): `vault`/pgsodium só existem num
-- projeto Supabase real — neste ambiente de teste local, um schema
-- `vault` simplificado é recriado em
-- tests/integration/fixtures/supabase-stub.sql (mesmo padrão já usado
-- para `auth`/`storage`, Etapas 2/8) só para validar a integração
-- estrutural, nunca a criptografia real do pgsodium.
create table public.payment_credentials_vault (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  provider text not null check (provider in ('mercadopago')),
  access_token_secret_id uuid not null references vault.secrets (id),
  refresh_token_secret_id uuid references vault.secrets (id),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_credentials_vault_tenant_provider_unique unique (tenant_id, provider)
);

alter table public.payment_credentials_vault enable row level security;
alter table public.payment_credentials_vault force row level security;

create trigger set_updated_at before update on public.payment_credentials_vault
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_id_change before update on public.payment_credentials_vault
  for each row execute function private.prevent_tenant_id_change();

-- Nenhuma policy para `anon` NEM `authenticated` — nem OWNER lê isto
-- diretamente. A única leitora é a função private.get_payment_credentials()
-- (próxima migration), executável só por `service_role` (arquitetura
-- §11.1: "a única leitora é uma função de biblioteca isolada"). RLS
-- forçada + zero policy = deny-all real, não por convenção.
comment on table public.payment_credentials_vault is
  'Sem NENHUMA RLS policy de propósito — acesso exclusivo via private.get_payment_credentials()/private.store_payment_credentials()/private.delete_payment_credentials() (service_role-only). Nunca lido por anon/authenticated diretamente.';
