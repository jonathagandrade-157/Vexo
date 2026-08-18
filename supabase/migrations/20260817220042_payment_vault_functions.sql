-- Etapa 11 — funções de acesso ao vault (arquitetura §11.1: "a única
-- leitora é uma função de biblioteca isolada"). Todas `service_role`-only
-- — nem `anon` nem `authenticated` recebem EXECUTE, nem mesmo OWNER: a
-- decisão de conectar já foi autorizada no momento do OAuth (Route
-- Handler autenticado, `payments.manage`); a partir daí, ler/gravar o
-- segredo em si é sempre uma operação de sistema.
create function private.store_payment_credentials(
  p_tenant_id uuid,
  p_provider text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz
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
  from public.payment_credentials_vault
  where tenant_id = p_tenant_id and provider = p_provider;

  v_access_secret_id := vault.create_secret(p_access_token, p_tenant_id::text || ':' || p_provider || ':access');
  if p_refresh_token is not null then
    v_refresh_secret_id := vault.create_secret(p_refresh_token, p_tenant_id::text || ':' || p_provider || ':refresh');
  end if;

  insert into public.payment_credentials_vault (tenant_id, provider, access_token_secret_id, refresh_token_secret_id, expires_at)
  values (p_tenant_id, p_provider, v_access_secret_id, v_refresh_secret_id, p_expires_at)
  on conflict (tenant_id, provider)
  do update set
    access_token_secret_id = excluded.access_token_secret_id,
    refresh_token_secret_id = excluded.refresh_token_secret_id,
    expires_at = excluded.expires_at;

  -- Reconexão (ex.: lojista desconectou e conectou de novo, ou trocou de
  -- conta): remove os segredos antigos do vault — nunca deixa um token
  -- morto/revogado remanescente (mesmo princípio de "apagar
  -- fisicamente", §11.1).
  if v_old_access_secret_id is not null then
    delete from vault.secrets where id = v_old_access_secret_id;
  end if;
  if v_old_refresh_secret_id is not null then
    delete from vault.secrets where id = v_old_refresh_secret_id;
  end if;
end;
$$;

create function private.get_payment_credentials(p_tenant_id uuid, p_provider text)
returns table (access_token text, refresh_token text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select da.decrypted_secret, dr.decrypted_secret
  from public.payment_credentials_vault v
  left join vault.decrypted_secrets da on da.id = v.access_token_secret_id
  left join vault.decrypted_secrets dr on dr.id = v.refresh_token_secret_id
  where v.tenant_id = p_tenant_id and v.provider = p_provider;
end;
$$;

create function private.delete_payment_credentials(p_tenant_id uuid, p_provider text)
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
  from public.payment_credentials_vault
  where tenant_id = p_tenant_id and provider = p_provider;

  delete from public.payment_credentials_vault where tenant_id = p_tenant_id and provider = p_provider;

  if v_access_secret_id is not null then
    delete from vault.secrets where id = v_access_secret_id;
  end if;
  if v_refresh_secret_id is not null then
    delete from vault.secrets where id = v_refresh_secret_id;
  end if;
end;
$$;

revoke all on function private.store_payment_credentials(uuid, text, text, text, timestamptz) from public;
revoke all on function private.get_payment_credentials(uuid, text) from public;
revoke all on function private.delete_payment_credentials(uuid, text) from public;
grant execute on function private.store_payment_credentials(uuid, text, text, text, timestamptz) to service_role;
grant execute on function private.get_payment_credentials(uuid, text) to service_role;
grant execute on function private.delete_payment_credentials(uuid, text) to service_role;
