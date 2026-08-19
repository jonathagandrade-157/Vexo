-- Etapa 7 — auditoria de categorias/produtos (prompt Etapa 7 §20).
--
-- Mesmo private.log_audit() de sempre (Etapa 2), mesmo padrão de trigger
-- automático SECURITY DEFINER já usado para tenants (0010/0019/0021) —
-- nenhum sistema de log paralelo. actor sempre derivado internamente por
-- log_audit(), nunca aceito como parâmetro.
create function private.audit_category_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'CATEGORY_CREATED', 'category', new.id::text,
      null, jsonb_build_object('name', new.name, 'slug', new.slug, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' then
    perform private.log_audit(
      new.tenant_id, 'CATEGORY_UPDATED', 'category', new.id::text,
      jsonb_build_object('name', old.name, 'slug', old.slug, 'description', old.description, 'status', old.status, 'sort_order', old.sort_order),
      jsonb_build_object('name', new.name, 'slug', new.slug, 'description', new.description, 'status', new.status, 'sort_order', new.sort_order)
    );
  elsif tg_op = 'DELETE' then
    perform private.log_audit(
      old.tenant_id, 'CATEGORY_DELETED', 'category', old.id::text,
      jsonb_build_object('name', old.name, 'slug', old.slug), null
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger audit_category_changes
  after insert or update or delete on public.categories
  for each row
  execute function private.audit_category_changes();

create function private.audit_product_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'PRODUCT_CREATED', 'product', new.id::text,
      null,
      jsonb_build_object('name', new.name, 'slug', new.slug, 'price', new.price, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform private.log_audit(
      new.tenant_id, 'PRODUCT_STATUS_CHANGED', 'product', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status)
    );
  elsif tg_op = 'UPDATE' then
    perform private.log_audit(
      new.tenant_id, 'PRODUCT_UPDATED', 'product', new.id::text,
      jsonb_build_object(
        'name', old.name, 'slug', old.slug, 'description', old.description,
        'price', old.price, 'promotional_price', old.promotional_price,
        'sku', old.sku, 'category_id', old.category_id, 'main_image', old.main_image
      ),
      jsonb_build_object(
        'name', new.name, 'slug', new.slug, 'description', new.description,
        'price', new.price, 'promotional_price', new.promotional_price,
        'sku', new.sku, 'category_id', new.category_id, 'main_image', new.main_image
      )
    );
  elsif tg_op = 'DELETE' then
    perform private.log_audit(
      old.tenant_id, 'PRODUCT_DELETED', 'product', old.id::text,
      jsonb_build_object('name', old.name, 'slug', old.slug), null
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger audit_product_changes
  after insert or update or delete on public.products
  for each row
  execute function private.audit_product_changes();
