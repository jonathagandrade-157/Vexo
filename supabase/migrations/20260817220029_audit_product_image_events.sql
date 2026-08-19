-- Etapa 8 — auditoria de imagem de produto (prompt Etapa 8 §14). Estende
-- o mesmo private.audit_product_changes() da Etapa 7 (nenhum sistema de
-- log paralelo) com 3 ramos verificados antes do PRODUCT_UPDATED
-- genérico, do mesmo jeito que PRODUCT_STATUS_CHANGED já é — um UPDATE
-- que só troca main_image vira PRODUCT_IMAGE_UPLOADED (era null),
-- PRODUCT_IMAGE_DELETED (vira null) ou PRODUCT_IMAGE_UPDATED (troca de
-- um valor por outro).
create or replace function private.audit_product_changes()
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
  elsif tg_op = 'UPDATE' and old.main_image is distinct from new.main_image then
    perform private.log_audit(
      new.tenant_id,
      case
        when old.main_image is null then 'PRODUCT_IMAGE_UPLOADED'
        when new.main_image is null then 'PRODUCT_IMAGE_DELETED'
        else 'PRODUCT_IMAGE_UPDATED'
      end,
      'product', new.id::text,
      jsonb_build_object('main_image', old.main_image), jsonb_build_object('main_image', new.main_image)
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
