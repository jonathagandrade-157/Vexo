-- Etapa 14 (ajuste arquitetural) — auditoria de plan_limits, mesmo
-- princípio de audit_plan_feature_changes (migration 20260817220057).
-- tenant_id NULL (não é evento de um tenant — é configuração global de
-- plano, mesmo padrão já usado para PLAN_*/FEATURE_*).
create function private.audit_plan_limit_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      null, 'PLAN_LIMIT_SET', 'plan_limit', new.id::text,
      null, jsonb_build_object('plan_id', new.plan_id, 'limit_key', new.limit_key, 'limit_value', new.limit_value)
    );
  elsif tg_op = 'UPDATE' and old.limit_value is distinct from new.limit_value then
    perform private.log_audit(
      null, 'PLAN_LIMIT_UPDATED', 'plan_limit', new.id::text,
      jsonb_build_object('limit_value', old.limit_value), jsonb_build_object('limit_value', new.limit_value)
    );
  elsif tg_op = 'DELETE' then
    perform private.log_audit(
      null, 'PLAN_LIMIT_REMOVED', 'plan_limit', old.id::text,
      jsonb_build_object('plan_id', old.plan_id, 'limit_key', old.limit_key, 'limit_value', old.limit_value), null
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger audit_plan_limit_changes
  after insert or update or delete on public.plan_limits
  for each row
  execute function private.audit_plan_limit_changes();
