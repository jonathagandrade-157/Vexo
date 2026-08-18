-- Etapa 5 — estende (mais uma vez) o mesmo trigger de auditoria de
-- tenants (0010, já estendido em 0019 para TENANT_ONBOARDING_COMPLETED).
-- Ainda o mesmo private.log_audit(), nenhum sistema de log paralelo.
--
-- TENANT_SETTINGS_UPDATED cobre edições feitas DEPOIS do onboarding
-- concluído (tela /painel/configuracoes) — a transição de conclusão do
-- onboarding em si continua tendo seu próprio evento (branch anterior,
-- checado primeiro), então a primeira gravação (que também muda esses
-- mesmos campos) não gera os dois eventos, só TENANT_ONBOARDING_COMPLETED.
-- Reenvio com os mesmos valores (double submit) não gera evento nenhum,
-- porque "is distinct from" só é verdadeiro quando algo de fato mudou.
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
  end if;
  return new;
end;
$$;
