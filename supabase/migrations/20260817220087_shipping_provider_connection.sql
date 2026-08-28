-- D3.2-B — Conexão OAuth com Melhor Envio (Ponto 1: SOMENTE conectar a
-- conta; nenhuma cotação/etiqueta/rastreio nesta etapa). Espelha 1:1 o
-- padrão de pagamentos (Etapa 11): store_payment_providers ->
-- store_shipping_providers (metadado público, nunca segredo),
-- payment_credentials_vault -> shipping_credentials_vault (só
-- referências a vault.secrets, nunca token em texto puro),
-- payments.view/.manage -> shipping_provider.view/.manage. `provider`
-- é uma família nova ("melhor_envio"), não reaproveita as tabelas do
-- Mercado Pago (auditoria D3.2 Ponto 1 §5: domínios de pagamento e
-- logística nunca são fundidos na mesma tabela neste projeto).
--
-- Diferença estrutural única: o Melhor Envio tem DOIS prazos de
-- expiração (access_token: 30 dias: refresh_token: 45 dias — confirmado
-- via docs.melhorenvio.com.br), por isso `refresh_expires_at` existe
-- aqui e não existe em payment_credentials_vault.

-- ---------------------------------------------------------------------
-- Permissões (mesmo critério de payments.manage: conectar/desconectar
-- uma conta externa é mais sensível que só visualizar — MANAGER só tem
-- .view, igual ao padrão de pagamentos, não ao padrão usual de
-- *.manage/*.update deste projeto).
-- ---------------------------------------------------------------------
insert into public.permissions (key, group_name, description) values
  ('shipping_provider.view', 'shipping_provider', 'Ver a conexão com o Melhor Envio'),
  ('shipping_provider.manage', 'shipping_provider', 'Conectar/desconectar a conta do Melhor Envio');

with role_permission_pairs (role_key, permission_key) as (
  values
    ('OWNER', 'shipping_provider.view'), ('OWNER', 'shipping_provider.manage'),
    ('ADMIN', 'shipping_provider.view'), ('ADMIN', 'shipping_provider.manage'),
    ('MANAGER', 'shipping_provider.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_permission_pairs rp
join public.roles r on r.key = rp.role_key
join public.permissions p on p.key = rp.permission_key;

-- ---------------------------------------------------------------------
-- store_shipping_providers — metadado público da conexão (nunca token).
-- ---------------------------------------------------------------------
create table public.store_shipping_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  provider text not null check (provider in ('melhor_envio')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected')),
  connected_account_id text,
  connected_account_email text,
  -- Ambiente OAuth usado na conexão (sandbox.melhorenvio.com.br vs
  -- melhorenvio.com.br) — equivalente ao `live_mode` do Mercado Pago.
  sandbox boolean,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_shipping_providers_tenant_provider_unique unique (tenant_id, provider)
);

create index store_shipping_providers_tenant_id_idx on public.store_shipping_providers (tenant_id);

alter table public.store_shipping_providers enable row level security;
alter table public.store_shipping_providers force row level security;

create trigger set_updated_at before update on public.store_shipping_providers
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_id_change before update on public.store_shipping_providers
  for each row execute function private.prevent_tenant_id_change();

create policy "tenant staff with shipping_provider.view can select shipping providers"
  on public.store_shipping_providers for select
  to authenticated
  using (private.has_permission(tenant_id, 'shipping_provider.view') or private.is_platform_admin());

create policy "tenant staff with shipping_provider.manage can insert shipping providers"
  on public.store_shipping_providers for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'shipping_provider.manage'));

create policy "tenant staff with shipping_provider.manage can update shipping providers"
  on public.store_shipping_providers for update
  to authenticated
  using (private.has_permission(tenant_id, 'shipping_provider.manage'))
  with check (private.has_permission(tenant_id, 'shipping_provider.manage'));

-- Esta migration roda DEPOIS de 20260817220067_grant_base_table_privileges
-- (que alterou os default privileges de toda tabela FUTURA criada pelo
-- role `postgres` para já nascer com select/insert/update/delete
-- concedido a anon/authenticated/service_role). Sem este ajuste, esta
-- tabela nova herdaria silenciosamente um grant de DELETE para
-- `authenticated` e qualquer grant para `anon` — nenhum dos dois existe
-- para store_payment_providers (criada ANTES do default privileges ser
-- corrigido). Revoga tudo e reconcede explicitamente só o necessário,
-- reproduzindo de propósito o mesmo desenho de acesso de
-- store_payment_providers ("nunca delete, nunca anon").
revoke all on public.store_shipping_providers from anon, authenticated;
grant select, insert, update on public.store_shipping_providers to authenticated;

-- ---------------------------------------------------------------------
-- shipping_credentials_vault — só referências a vault.secrets (Supabase
-- Vault/pgsodium), nunca texto puro. Mesmo desenho de
-- payment_credentials_vault: RLS forçada + ZERO policy = deny-all real.
-- ---------------------------------------------------------------------
create table public.shipping_credentials_vault (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  provider text not null check (provider in ('melhor_envio')),
  access_token_secret_id uuid not null references vault.secrets (id),
  refresh_token_secret_id uuid references vault.secrets (id),
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_credentials_vault_tenant_provider_unique unique (tenant_id, provider)
);

alter table public.shipping_credentials_vault enable row level security;
alter table public.shipping_credentials_vault force row level security;

create trigger set_updated_at before update on public.shipping_credentials_vault
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_id_change before update on public.shipping_credentials_vault
  for each row execute function private.prevent_tenant_id_change();

-- Nenhuma policy para `anon` NEM `authenticated` — nem OWNER lê isto
-- diretamente. A única leitora é private.get_shipping_credentials(),
-- executável só por `service_role`. Mesmo desenho de
-- payment_credentials_vault: o grant de tabela em si (herdado do default
-- privileges do ambiente) não é revogado — a proteção real é a RLS
-- forçada + zero policy (deny-all), e o próprio conteúdo da tabela nunca
-- é o segredo (só um `uuid` apontando para `vault.secrets`, que
-- `anon`/`authenticated` nunca têm acesso). Consistente de propósito com
-- payment_credentials_vault, para não haver dois modelos de acesso
-- diferentes para a mesma classe de tabela.
comment on table public.shipping_credentials_vault is
  'Sem NENHUMA RLS policy de propósito — acesso exclusivo via private.get_shipping_credentials()/private.store_shipping_credentials()/private.delete_shipping_credentials() (service_role-only). Nunca lido por anon/authenticated diretamente.';

-- ---------------------------------------------------------------------
-- Funções de acesso ao vault — todas `service_role`-only (mesmo desenho
-- de private.store_payment_credentials/get_payment_credentials/
-- delete_payment_credentials). A decisão de conectar já foi autorizada
-- no callback (Route Handler autenticado, shipping_provider.manage
-- revalidado); a partir daí, ler/gravar o segredo em si é operação de
-- sistema.
-- ---------------------------------------------------------------------
create function private.store_shipping_credentials(
  p_tenant_id uuid,
  p_provider text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_refresh_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access_secret_id uuid;
  v_refresh_secret_id uuid;
  v_old_access_secret_id uuid;
  v_old_refresh_secret_id uuid;
begin
  select access_token_secret_id, refresh_token_secret_id
  into v_old_access_secret_id, v_old_refresh_secret_id
  from public.shipping_credentials_vault
  where tenant_id = p_tenant_id and provider = p_provider;

  v_access_secret_id := vault.create_secret(p_access_token, p_tenant_id::text || ':' || p_provider || ':access');
  if p_refresh_token is not null then
    v_refresh_secret_id := vault.create_secret(p_refresh_token, p_tenant_id::text || ':' || p_provider || ':refresh');
  end if;

  insert into public.shipping_credentials_vault (
    tenant_id, provider, access_token_secret_id, refresh_token_secret_id, expires_at, refresh_expires_at
  )
  values (p_tenant_id, p_provider, v_access_secret_id, v_refresh_secret_id, p_expires_at, p_refresh_expires_at)
  on conflict (tenant_id, provider)
  do update set
    access_token_secret_id = excluded.access_token_secret_id,
    refresh_token_secret_id = excluded.refresh_token_secret_id,
    expires_at = excluded.expires_at,
    refresh_expires_at = excluded.refresh_expires_at;

  -- Reconexão (ou renovação futura de token): remove os segredos
  -- antigos do vault — nunca deixa um token morto/revogado remanescente.
  if v_old_access_secret_id is not null then
    delete from vault.secrets where id = v_old_access_secret_id;
  end if;
  if v_old_refresh_secret_id is not null then
    delete from vault.secrets where id = v_old_refresh_secret_id;
  end if;
end;
$$;

create function private.get_shipping_credentials(p_tenant_id uuid, p_provider text)
returns table (access_token text, refresh_token text, expires_at timestamptz, refresh_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select da.decrypted_secret, dr.decrypted_secret, v.expires_at, v.refresh_expires_at
  from public.shipping_credentials_vault v
  left join vault.decrypted_secrets da on da.id = v.access_token_secret_id
  left join vault.decrypted_secrets dr on dr.id = v.refresh_token_secret_id
  where v.tenant_id = p_tenant_id and v.provider = p_provider;
end;
$$;

create function private.delete_shipping_credentials(p_tenant_id uuid, p_provider text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access_secret_id uuid;
  v_refresh_secret_id uuid;
begin
  select access_token_secret_id, refresh_token_secret_id
  into v_access_secret_id, v_refresh_secret_id
  from public.shipping_credentials_vault
  where tenant_id = p_tenant_id and provider = p_provider;

  delete from public.shipping_credentials_vault where tenant_id = p_tenant_id and provider = p_provider;

  if v_access_secret_id is not null then
    delete from vault.secrets where id = v_access_secret_id;
  end if;
  if v_refresh_secret_id is not null then
    delete from vault.secrets where id = v_refresh_secret_id;
  end if;
end;
$$;

revoke all on function private.store_shipping_credentials(uuid, text, text, text, timestamptz, timestamptz) from public;
revoke all on function private.get_shipping_credentials(uuid, text) from public;
revoke all on function private.delete_shipping_credentials(uuid, text) from public;
grant execute on function private.store_shipping_credentials(uuid, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function private.get_shipping_credentials(uuid, text) to service_role;
grant execute on function private.delete_shipping_credentials(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- Auditoria — mesmo padrão de private.audit_payment_provider_changes()
-- (reaproveita private.mask_account_id(), já genérico). Sempre disparado
-- por uma sessão de staff autenticada de verdade (o callback exige
-- sessão+tenant+shipping_provider.manage antes de gravar) — nunca por um
-- ator anônimo/sistema, então nenhuma exceção nova é necessária em
-- private.log_audit() (o guard de is_tenant_member já cobre este caso).
-- ---------------------------------------------------------------------
create function private.audit_shipping_provider_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'connected') then
    perform private.log_audit(
      new.tenant_id, 'SHIPPING_PROVIDER_CONNECTION_CREATED', 'shipping_provider', new.id::text,
      null, jsonb_build_object('provider', new.provider, 'connected_account_id', private.mask_account_id(new.connected_account_id))
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'disconnected' then
    perform private.log_audit(
      new.tenant_id, 'SHIPPING_PROVIDER_CONNECTION_REMOVED', 'shipping_provider', new.id::text,
      jsonb_build_object('provider', old.provider), null
    );
  end if;
  return new;
end;
$$;

create trigger audit_shipping_provider_changes
  after insert or update on public.store_shipping_providers
  for each row
  execute function private.audit_shipping_provider_changes();
