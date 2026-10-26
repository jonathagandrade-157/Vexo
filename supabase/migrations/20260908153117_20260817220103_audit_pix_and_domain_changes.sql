-- D18.1 — fecha os dois gaps de auditoria classificados como ALTO na
-- auditoria D18.0 (relatório D18.0 §H): mudanças de PIX direto em
-- `tenants` e todo o CRUD de `tenant_domains` (cadastro, verificação DNS
-- TXT, binding Vercel) não geravam nenhuma entrada em `audit_logs`.
--
-- Mesmo padrão de sempre: nenhuma chamada manual a log_audit() nas Server
-- Actions, só trigger SQL + private.log_audit() (já existente, não
-- alterado aqui) — arquitetura §18.2 ("estruturalmente acoplado à
-- mutação, não uma etapa opcional de código"). Nenhuma exceção nova é
-- necessária na guarda de autorização de private.log_audit() (migration
-- 20260817220010, revisada em 220044): tanto `tenants` (staff autenticado
-- via RLS normal) quanto `tenant_domains` (sempre via `service_role`, D17.1
-- — RLS de `authenticated` fica para D18.2) já passam pela guarda
-- existente sem modificação, exatamente como shipping_settings/
-- shipping_methods (220049) e store_payment_providers/payments (220044)
-- já passam hoje.

-- ============================================================
-- 1) PIX direto em `tenants` (tenants.pix_enabled/pix_key/pix_key_type/
--    pix_recipient_name, migration 20260817220083) — TENANT_PIX_SETTINGS_UPDATED
-- ============================================================
--
-- Estende (mais uma vez) a mesma função private.audit_tenant_changes()
-- já usada para TENANT_CREATED/TENANT_STATUS_CHANGED/TENANT_SUSPENDED/
-- TENANT_ONBOARDING_COMPLETED/TENANT_SETTINGS_UPDATED (220010, 220019,
-- 220021) — mesmo trigger `audit_tenant_changes` em `tenants`, nenhum
-- trigger novo precisa ser criado, só a função é substituída.
--
-- "is distinct from" nos 4 campos evita gravar um evento quando um UPDATE
-- não muda nenhum dado de PIX de fato (double submit do formulário, ou um
-- UPDATE de outro grupo de campos que não toca PIX) — mesmo raciocínio já
-- documentado para TENANT_SETTINGS_UPDATED.
--
-- Sanitização: `pix_key` pode ser CPF/CNPJ, telefone ou e-mail (dado
-- pessoal, ainda que hoje já visível ao cliente final no checkout via a
-- policy pública de `anon` em `tenants`) — diferente da exposição ao vivo
-- (reflete só o valor ATUAL), `audit_logs` guarda HISTÓRICO permanente de
-- todo valor já usado, inclusive chaves antigas/trocadas. Por isso
-- aplicamos o mesmo mascaramento já usado para connected_account_id em
-- store_payment_providers (private.mask_account_id, criada em 220044,
-- reaproveitada aqui sem alteração) — nunca a chave em texto puro no log.
-- pix_recipient_name continua sem máscara: é só um nome de exibição, já
-- público no checkout, sem o mesmo risco de reidentificação de uma chave
-- PIX baseada em CPF/telefone/e-mail.
create or replace function private.audit_tenant_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.id, 'TENANT_CREATED', 'tenant', new.id::text,
      null, jsonb_build_object('name', new.name, 'slug', new.slug, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform private.log_audit(
      new.id,
      case new.status when 'suspended' then 'TENANT_SUSPENDED' else 'TENANT_STATUS_CHANGED' end,
      'tenant', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status)
    );
  elsif tg_op = 'UPDATE'
        and old.onboarding_completed_at is null
        and new.onboarding_completed_at is not null then
    perform private.log_audit(
      new.id, 'TENANT_ONBOARDING_COMPLETED', 'tenant', new.id::text,
      null, jsonb_build_object('onboarding_completed_at', new.onboarding_completed_at)
    );
  elsif tg_op = 'UPDATE'
        and (
          old.name is distinct from new.name
          or old.segment is distinct from new.segment
          or old.description is distinct from new.description
          or old.instagram_handle is distinct from new.instagram_handle
          or old.whatsapp_phone is distinct from new.whatsapp_phone
          or old.contact_email is distinct from new.contact_email
        )
  then
    perform private.log_audit(
      new.id, 'TENANT_SETTINGS_UPDATED', 'tenant', new.id::text,
      jsonb_build_object(
        'name', old.name, 'segment', old.segment, 'description', old.description,
        'instagram_handle', old.instagram_handle, 'whatsapp_phone', old.whatsapp_phone,
        'contact_email', old.contact_email
      ),
      jsonb_build_object(
        'name', new.name, 'segment', new.segment, 'description', new.description,
        'instagram_handle', new.instagram_handle, 'whatsapp_phone', new.whatsapp_phone,
        'contact_email', new.contact_email
      )
    );
  elsif tg_op = 'UPDATE'
        and (
          old.pix_enabled is distinct from new.pix_enabled
          or old.pix_key is distinct from new.pix_key
          or old.pix_key_type is distinct from new.pix_key_type
          or old.pix_recipient_name is distinct from new.pix_recipient_name
        )
  then
    perform private.log_audit(
      new.id, 'TENANT_PIX_SETTINGS_UPDATED', 'tenant', new.id::text,
      jsonb_build_object(
        'pix_enabled', old.pix_enabled,
        'pix_key_type', old.pix_key_type,
        'pix_key', private.mask_account_id(old.pix_key),
        'pix_recipient_name', old.pix_recipient_name
      ),
      jsonb_build_object(
        'pix_enabled', new.pix_enabled,
        'pix_key_type', new.pix_key_type,
        'pix_key', private.mask_account_id(new.pix_key),
        'pix_recipient_name', new.pix_recipient_name
      )
    );
  end if;
  return new;
end;
$$;

-- ============================================================
-- 2) `tenant_domains` (cadastro D17.1/220100, verificação DNS TXT
--    D17.3.1/220101, binding Vercel D17.5.1/220102) —
--    TENANT_DOMAIN_CREATED / TENANT_DOMAIN_UPDATED / TENANT_DOMAIN_DELETED
-- ============================================================
--
-- Nenhum trigger existia nesta tabela antes desta migration (confirmado
-- por consulta a pg_trigger antes de escrever esta migration — auditoria
-- D18.0 §H, item "CRUD completo de tenant_domains... sem qualquer
-- auditoria"). Mesmo molde estrutural de private.audit_shipping_method_changes
-- (220049): tabela 1:N com tenant_id, INSERT/UPDATE/DELETE relevantes,
-- DELETE usa old.tenant_id (tenant_id não existe em NEW), retorno
-- coalesce(new, old).
--
-- Cobre exatamente os campos listados no ticket D18.1: domain, domain_type,
-- status, verified_at, verification_method, verification_started_at,
-- verification_expires_at, last_verification_at, verification_token_hash
-- (só presença/ausência, nunca o valor — ver nota abaixo),
-- vercel_domain_status, vercel_registered_at, vercel_error_code,
-- vercel_last_checked_at. `is_primary`/`created_at` ficam fora do escopo
-- pedido (nenhuma Server Action hoje muda is_primary depois do INSERT).
--
-- Sanitização de verification_token_hash: mesmo já sendo um SHA-256 (não
-- reversível, migration 220101) e não o valor em texto puro do challenge,
-- o ticket pede cautela extra — o hash em si NUNCA entra em before/after,
-- só um booleano (`verification_token_present`) indicando se um desafio
-- estava/ficou ativo, suficiente para reconstruir a linha do tempo sem
-- carregar nenhum material do desafio para audit_logs (que tem uma
-- audiência de leitura mais ampla — qualquer membro ativo do tenant, não
-- só quem tem settings.update — do que a coluna em si, que só é lida
-- pelas Server Actions via service_role).
create function private.audit_tenant_domain_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'TENANT_DOMAIN_CREATED', 'tenant_domain', new.id::text,
      null,
      jsonb_build_object(
        'domain', new.domain, 'domain_type', new.domain_type,
        'is_primary', new.is_primary, 'status', new.status
      )
    );
  elsif tg_op = 'UPDATE'
        and (
          old.domain is distinct from new.domain
          or old.domain_type is distinct from new.domain_type
          or old.status is distinct from new.status
          or old.verified_at is distinct from new.verified_at
          or old.verification_method is distinct from new.verification_method
          or old.verification_started_at is distinct from new.verification_started_at
          or old.verification_expires_at is distinct from new.verification_expires_at
          or old.last_verification_at is distinct from new.last_verification_at
          or old.verification_token_hash is distinct from new.verification_token_hash
          or old.vercel_domain_status is distinct from new.vercel_domain_status
          or old.vercel_registered_at is distinct from new.vercel_registered_at
          or old.vercel_error_code is distinct from new.vercel_error_code
          or old.vercel_last_checked_at is distinct from new.vercel_last_checked_at
        )
  then
    perform private.log_audit(
      new.tenant_id, 'TENANT_DOMAIN_UPDATED', 'tenant_domain', new.id::text,
      jsonb_build_object(
        'domain', old.domain, 'domain_type', old.domain_type, 'status', old.status,
        'verified_at', old.verified_at,
        'verification_method', old.verification_method,
        'verification_started_at', old.verification_started_at,
        'verification_expires_at', old.verification_expires_at,
        'last_verification_at', old.last_verification_at,
        'verification_token_present', (old.verification_token_hash is not null),
        'vercel_domain_status', old.vercel_domain_status,
        'vercel_registered_at', old.vercel_registered_at,
        'vercel_error_code', old.vercel_error_code,
        'vercel_last_checked_at', old.vercel_last_checked_at
      ),
      jsonb_build_object(
        'domain', new.domain, 'domain_type', new.domain_type, 'status', new.status,
        'verified_at', new.verified_at,
        'verification_method', new.verification_method,
        'verification_started_at', new.verification_started_at,
        'verification_expires_at', new.verification_expires_at,
        'last_verification_at', new.last_verification_at,
        'verification_token_present', (new.verification_token_hash is not null),
        'vercel_domain_status', new.vercel_domain_status,
        'vercel_registered_at', new.vercel_registered_at,
        'vercel_error_code', new.vercel_error_code,
        'vercel_last_checked_at', new.vercel_last_checked_at
      )
    );
  elsif tg_op = 'DELETE' then
    perform private.log_audit(
      old.tenant_id, 'TENANT_DOMAIN_DELETED', 'tenant_domain', old.id::text,
      jsonb_build_object('domain', old.domain, 'domain_type', old.domain_type, 'status', old.status),
      null
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger audit_tenant_domain_changes
  after insert or update or delete on public.tenant_domains
  for each row
  execute function private.audit_tenant_domain_changes();
