-- Etapa 12 — auditoria de frete/entrega (prompt §15/§25: ex.
-- SHIPPING_SETTINGS_UPDATED, sem expor segredo nenhum — não há segredo
-- aqui, é configuração pública do lojista). Mesmo padrão de trigger
-- automático SECURITY DEFINER de audit_catalog_events.sql (Etapa 7) —
-- nenhuma exceção nova em private.log_audit() é necessária: estas
-- tabelas só são escritas por `authenticated` com settings.update (uma
-- sessão de staff real), o mesmo caminho já coberto pela guarda
-- existente (is_tenant_member/is_platform_admin), diferente de
-- ORDER_CREATED/PAYMENT_CREATED que precisaram de exceção para `anon`.
create function private.audit_shipping_settings_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'SHIPPING_SETTINGS_UPDATED', 'shipping_settings', new.tenant_id::text,
      null, jsonb_build_object('enabled', new.enabled, 'origin_zip', new.origin_zip)
    );
  elsif tg_op = 'UPDATE' then
    perform private.log_audit(
      new.tenant_id, 'SHIPPING_SETTINGS_UPDATED', 'shipping_settings', new.tenant_id::text,
      jsonb_build_object('enabled', old.enabled, 'origin_zip', old.origin_zip),
      jsonb_build_object('enabled', new.enabled, 'origin_zip', new.origin_zip)
    );
  end if;
  return new;
end;
$$;

create trigger audit_shipping_settings_changes
  after insert or update on public.shipping_settings
  for each row
  execute function private.audit_shipping_settings_changes();

create function private.audit_shipping_method_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'SHIPPING_METHOD_CREATED', 'shipping_method', new.id::text,
      null, jsonb_build_object('name', new.name, 'type', new.type, 'price', new.price, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' then
    perform private.log_audit(
      new.tenant_id, 'SHIPPING_METHOD_UPDATED', 'shipping_method', new.id::text,
      jsonb_build_object('name', old.name, 'price', old.price, 'estimated_days', old.estimated_days, 'status', old.status, 'sort_order', old.sort_order),
      jsonb_build_object('name', new.name, 'price', new.price, 'estimated_days', new.estimated_days, 'status', new.status, 'sort_order', new.sort_order)
    );
  elsif tg_op = 'DELETE' then
    perform private.log_audit(
      old.tenant_id, 'SHIPPING_METHOD_DELETED', 'shipping_method', old.id::text,
      jsonb_build_object('name', old.name, 'price', old.price), null
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger audit_shipping_method_changes
  after insert or update or delete on public.shipping_methods
  for each row
  execute function private.audit_shipping_method_changes();
