-- D3.2-B Ponto 1B — renovação automática do access_token do Melhor
-- Envio. A estrutura de 20260817220087 já guarda tudo que a renovação em
-- si precisa (access_token/refresh_token no Vault, expires_at,
-- refresh_expires_at) — a ÚNICA lacuna estrutural real é um mecanismo de
-- concorrência: o VEXO roda em ambiente serverless (sem estado de
-- processo Node.js compartilhado entre invocações), então duas
-- requisições simultâneas percebendo o mesmo token perto de expirar não
-- podem coordenar por memória — precisam de um lock que more no
-- PostgreSQL.
--
-- Não usa `pg_advisory_xact_lock` (o padrão já existente em
-- enforce_plan_limits.sql, migration 20260817220065): aquele lock só
-- protege operações que terminam DENTRO da mesma transação Postgres — a
-- chamada HTTP ao Melhor Envio é lenta e acontece no servidor Node,
-- inteiramente FORA de qualquer transação de banco. Segurar um advisory
-- lock (ou qualquer lock de transação) durante uma chamada de rede
-- externa é uma prática ruim conhecida (mantém uma transação aberta por
-- tempo indeterminado). Em vez disso, usa um "lease" (reserva com prazo)
-- baseado numa coluna: `refresh_locked_at`. A reivindicação do lease em
-- si (`acquire_shipping_credentials_refresh_lease`) é uma única
-- instrução UPDATE...WHERE...RETURNING — atômica por natureza do MVCC do
-- Postgres, sem precisar de lock explícito adicional — e retorna em
-- milissegundos; só DEPOIS dela, já fora de qualquer transação, o
-- servidor faz a chamada HTTP.
alter table public.shipping_credentials_vault
  add column refresh_locked_at timestamptz;

comment on column public.shipping_credentials_vault.refresh_locked_at is
  'Lease de renovação (D3.2-B Ponto 1B) — timestamp de quando uma renovação foi reivindicada. Não é um lock de transação: a chamada HTTP ao Melhor Envio acontece fora de qualquer transação. Expira sozinho após REFRESH_LEASE_SECONDS (lib/shipping-connections/refresh.ts) mesmo se o processo que reivindicou morrer no meio da chamada.';

-- ---------------------------------------------------------------------
-- Reivindica (ou recusa) o direito de renovar. Único ponto de decisão
-- sobre "precisa renovar" e "alguém já está renovando" — nunca duplicado
-- em código de aplicação, para não haver dois lugares decidindo isso de
-- formas diferentes sob concorrência real.
-- ---------------------------------------------------------------------
create function private.acquire_shipping_credentials_refresh_lease(
  p_tenant_id uuid,
  p_provider text,
  p_margin_seconds integer,
  p_lease_seconds integer
)
returns table (
  claimed boolean,
  reason text,
  refresh_token text,
  expires_at timestamptz,
  refresh_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_claimed_id uuid;
  v_claim record;
  v_current record;
begin
  -- Reivindicação atômica: só atualiza (e portanto só "ganha" a corrida)
  -- se o token estiver perto o bastante de expirar E nenhum outro lease
  -- válido estiver em vigor. Uma única instrução UPDATE é serializada
  -- pelo próprio Postgres entre transações concorrentes na mesma linha —
  -- não existe janela em que duas chamadas simultâneas reivindiquem com
  -- sucesso ao mesmo tempo.
  update public.shipping_credentials_vault v
  set refresh_locked_at = v_now
  where v.tenant_id = p_tenant_id
    and v.provider = p_provider
    and v.expires_at is not null
    and v.expires_at <= v_now + make_interval(secs => p_margin_seconds)
    and (v.refresh_locked_at is null or v.refresh_locked_at < v_now - make_interval(secs => p_lease_seconds))
  returning v.id into v_claimed_id;

  if v_claimed_id is not null then
    select rt.decrypted_secret as refresh_token, v.expires_at, v.refresh_expires_at
    into v_claim
    from public.shipping_credentials_vault v
    left join vault.decrypted_secrets rt on rt.id = v.refresh_token_secret_id
    where v.id = v_claimed_id;

    return query select true, 'claimed', v_claim.refresh_token, v_claim.expires_at, v_claim.refresh_expires_at;
    return;
  end if;

  -- Não reivindicou: só leitura (sem lock) para explicar por quê —
  -- nunca decrifra o refresh_token neste caminho (não é necessário).
  select v.expires_at, v.refresh_expires_at, v.refresh_locked_at
  into v_current
  from public.shipping_credentials_vault v
  where v.tenant_id = p_tenant_id and v.provider = p_provider;

  if not found then
    return query select false, 'not_connected', null::text, null::timestamptz, null::timestamptz;
  elsif v_current.expires_at is null or v_current.expires_at > v_now + make_interval(secs => p_margin_seconds) then
    return query select false, 'not_needed', null::text, v_current.expires_at, v_current.refresh_expires_at;
  else
    return query select false, 'already_refreshing', null::text, v_current.expires_at, v_current.refresh_expires_at;
  end if;
end;
$$;

-- Libera o lease sem tocar em mais nada — usado após uma falha
-- transitória (rede/5xx/rate limit), para a PRÓXIMA requisição (lazy, não
-- há cron) poder tentar de novo sem esperar o lease expirar sozinho.
create function private.release_shipping_credentials_refresh_lease(p_tenant_id uuid, p_provider text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.shipping_credentials_vault
  set refresh_locked_at = null
  where tenant_id = p_tenant_id and provider = p_provider;
$$;

revoke all on function private.acquire_shipping_credentials_refresh_lease(uuid, text, integer, integer) from public;
revoke all on function private.release_shipping_credentials_refresh_lease(uuid, text) from public;
grant execute on function private.acquire_shipping_credentials_refresh_lease(uuid, text, integer, integer) to service_role;
grant execute on function private.release_shipping_credentials_refresh_lease(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- store_shipping_credentials (20260817220087) passa a também limpar o
-- lease ao gravar um token novo com sucesso — nunca deixa um
-- `refresh_locked_at` obsoleto depois de uma renovação bem-sucedida.
-- `create or replace function` com a MESMA assinatura: altera o
-- comportamento sem tocar no arquivo da migration antiga (mesmo padrão
-- já usado por 20260817220044_audit_payments.sql sobre
-- private.log_audit(), criada em 20260817220010).
-- ---------------------------------------------------------------------
create or replace function private.store_shipping_credentials(
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
    refresh_expires_at = excluded.refresh_expires_at,
    refresh_locked_at = null;

  -- Reconexão/renovação: remove os segredos antigos do vault — nunca
  -- deixa um token morto/revogado remanescente. Só apaga DEPOIS que o
  -- insert/update acima (o novo token) já foi confirmado nesta mesma
  -- transação — nunca ao contrário.
  if v_old_access_secret_id is not null then
    delete from vault.secrets where id = v_old_access_secret_id;
  end if;
  if v_old_refresh_secret_id is not null then
    delete from vault.secrets where id = v_old_refresh_secret_id;
  end if;
end;
$$;
