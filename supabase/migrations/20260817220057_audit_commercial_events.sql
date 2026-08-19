-- Etapa 14 — auditoria da fundação comercial (prompt §27). Mesmo padrão
-- de trigger automático SECURITY DEFINER de audit_catalog_events.sql
-- (Etapa 7) / audit_shipping_events.sql (Etapa 12) — nenhuma chamada
-- manual dentro das Server Actions, estruturalmente acoplado à mutação.
--
-- tenant_id é NULL nos eventos de plans/features/plan_features (não são
-- tabelas tenant-scoped) — mesmo padrão já usado para USER_CREATED
-- (migration 0010, Etapa 2): private.log_audit() já aceita p_tenant_id
-- nulo e pula a checagem de autorização cross-tenant nesse caso (a
-- própria escrita já é MASTER-only via RLS, então nada extra a validar
-- aqui). TENANT_PLAN_CHANGED é o único evento desta migration com
-- tenant_id real.
create function private.audit_plan_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      null, 'PLAN_CREATED', 'plan', new.id::text,
      null, jsonb_build_object('slug', new.slug, 'name', new.name, 'is_active', new.is_active)
    );
  elsif tg_op = 'UPDATE' and old.is_active is distinct from new.is_active then
    perform private.log_audit(
      null, case when new.is_active then 'PLAN_ACTIVATED' else 'PLAN_DEACTIVATED' end, 'plan', new.id::text,
      jsonb_build_object('is_active', old.is_active), jsonb_build_object('is_active', new.is_active)
    );
  elsif tg_op = 'UPDATE' then
    perform private.log_audit(
      null, 'PLAN_UPDATED', 'plan', new.id::text,
      jsonb_build_object(
        'name', old.name, 'description', old.description, 'monthly_price', old.monthly_price,
        'yearly_price', old.yearly_price, 'trial_days', old.trial_days, 'is_featured', old.is_featured, 'sort_order', old.sort_order
      ),
      jsonb_build_object(
        'name', new.name, 'description', new.description, 'monthly_price', new.monthly_price,
        'yearly_price', new.yearly_price, 'trial_days', new.trial_days, 'is_featured', new.is_featured, 'sort_order', new.sort_order
      )
    );
  end if;
  return new;
end;
$$;

create trigger audit_plan_changes
  after insert or update on public.plans
  for each row
  execute function private.audit_plan_changes();

create function private.audit_feature_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      null, 'FEATURE_CREATED', 'feature', new.id::text,
      null, jsonb_build_object('key', new.key, 'name', new.name, 'is_active', new.is_active)
    );
  elsif tg_op = 'UPDATE' then
    perform private.log_audit(
      null, 'FEATURE_UPDATED', 'feature', new.id::text,
      jsonb_build_object('name', old.name, 'description', old.description, 'category', old.category, 'is_active', old.is_active),
      jsonb_build_object('name', new.name, 'description', new.description, 'category', new.category, 'is_active', new.is_active)
    );
  end if;
  return new;
end;
$$;

create trigger audit_feature_changes
  after insert or update on public.features
  for each row
  execute function private.audit_feature_changes();

-- plan_features não tem UPDATE (só existe/não existe) — INSERT
-- (liberou) e DELETE (removeu) já cobrem os dois eventos pedidos no
-- prompt §27 (PLAN_FEATURE_ENABLED/DISABLED).
create function private.audit_plan_feature_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      null, 'PLAN_FEATURE_ENABLED', 'plan_feature', new.plan_id::text || ':' || new.feature_id::text,
      null, jsonb_build_object('plan_id', new.plan_id, 'feature_id', new.feature_id)
    );
  elsif tg_op = 'DELETE' then
    perform private.log_audit(
      null, 'PLAN_FEATURE_DISABLED', 'plan_feature', old.plan_id::text || ':' || old.feature_id::text,
      jsonb_build_object('plan_id', old.plan_id, 'feature_id', old.feature_id), null
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger audit_plan_feature_changes
  after insert or delete on public.plan_features
  for each row
  execute function private.audit_plan_feature_changes();

-- subscriptions: TENANT_PLAN_CHANGED é o único evento tenant-scoped desta
-- migration — dispara na criação (primeira atribuição de plano) e em
-- qualquer troca de plan_id, nunca em mudança só de status
-- (trialing→active, por exemplo, não é "trocar de plano").
create function private.audit_subscription_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'TENANT_PLAN_CHANGED', 'subscription', new.id::text,
      null, jsonb_build_object('plan_id', new.plan_id, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' and old.plan_id is distinct from new.plan_id then
    perform private.log_audit(
      new.tenant_id, 'TENANT_PLAN_CHANGED', 'subscription', new.id::text,
      jsonb_build_object('plan_id', old.plan_id), jsonb_build_object('plan_id', new.plan_id)
    );
  end if;
  return new;
end;
$$;

create trigger audit_subscription_changes
  after insert or update on public.subscriptions
  for each row
  execute function private.audit_subscription_changes();
