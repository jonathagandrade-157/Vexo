-- Etapa 4 — estende o trigger de auditoria de tenants (0010) para
-- registrar a conclusão do onboarding. Não é um segundo sistema de
-- log: é o mesmo private.audit_tenant_changes()/private.log_audit() da
-- Etapa 2, só com mais um branch — mesmo padrão já usado para
-- TENANT_STATUS_CHANGED/TENANT_SUSPENDED.
--
-- Guarda contra duplicação: só dispara na transição null → not null.
-- Reenvio do formulário de onboarding depois de já concluído (double
-- submit, ou o usuário voltando à página) grava o mesmo UPDATE mas não
-- gera uma segunda entrada de auditoria, porque old.onboarding_completed_at
-- já não é mais null nesse caso.
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
  end if;
  return new;
end;
$$;
