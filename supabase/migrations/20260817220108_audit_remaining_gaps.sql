-- D18.5.1 — fecha os gaps de auditoria restantes identificados na
-- auditoria de segurança: colunas/tabelas adicionadas a `tenants` depois
-- de D18.1 (aparência, checkout_mode, endereço da loja) e a tabela
-- `storefront_banners` nunca ganharam um branch/trigger de auditoria —
-- confirmado por leitura direta das migrations 20260817220075/078/084/077
-- e de todas as Server Actions que escrevem nessas colunas/tabela
-- (`features/settings/appearance-actions.ts`, `checkout-actions.ts`,
-- `address-actions.ts`, `banner-actions.ts`).
--
-- `tenant_members` foi investigada e NÃO tem gap: só `role_id` e `status`
-- são de fato mutáveis por alguma Server Action (`features/team/actions.ts`,
-- `accept_tenant_invite()`), e ambos já são cobertos desde D18.3
-- (USER_ROLE_CHANGED / TEAM_MEMBER_STATUS_CHANGED / TEAM_MEMBER_INVITED /
-- TEAM_MEMBER_REMOVED) — nenhuma mudança necessária aqui.
--
-- Mesmo princípio de sempre: estende private.audit_tenant_changes()
-- (Etapa 2, já estendida em 20260817220019/021/103) via CREATE OR REPLACE
-- — nenhum sistema de log paralelo, nenhuma tabela de histórico nova,
-- nenhuma mudança em private.log_audit()/RLS/RBAC. `storefront_banners`
-- ganha um trigger próprio novo, mesmo molde exato de
-- private.audit_shipping_method_changes (20260817220049): tabela 1:N por
-- tenant, sem trigger de auditoria hoje.

-- ============================================================
-- 1) Aparência (logo_url/primary_color/secondary_color/storefront_template)
--    + checkout_mode + endereço da loja (address_*) — TENANT_APPEARANCE_UPDATED
--    / TENANT_CHECKOUT_MODE_UPDATED / TENANT_ADDRESS_UPDATED
-- ============================================================
--
-- Todos os 4 branches anteriores (INSERT/status/onboarding/settings/pix)
-- permanecem byte-a-byte idênticos — só 3 branches novos são acrescentados
-- ao fim, antes do `end if`.
--
-- TENANT_APPEARANCE_UPDATED cobre as 4 colunas juntas (mesmo conceito de
-- "identidade visual da loja", documentado como um único domínio em
-- tenant_appearance_fields, 20260817220075) — uma troca só de logo
-- (uploadStoreLogoAction/removeStoreLogoAction) e uma troca de cor/modelo
-- (updateStoreAppearanceAction) disparam o mesmo evento, cada uma só com
-- os campos que de fato mudaram no before/after (`is distinct from` por
-- coluna, mesmo padrão de TENANT_SETTINGS_UPDATED). `logo_url` é sempre um
-- PATH curto dentro do bucket tenant-media (nunca a imagem em si, nunca uma
-- URL completa) — seguro para o histórico, mesmo raciocínio já usado para
-- products.main_image.
--
-- TENANT_CHECKOUT_MODE_UPDATED e TENANT_ADDRESS_UPDATED ganham eventos
-- PRÓPRIOS (não somados a TENANT_SETTINGS_UPDATED) — mesma decisão já
-- tomada para PIX (20260817220103): são domínios de configuração
-- distintos do "perfil da loja" (nome/segmento/descrição/redes/contato),
-- cada um com sua própria Server Action e sua própria mensagem de
-- permissão. Endereço da loja (address_*) é dado comercial da PRÓPRIA
-- loja — não é dado pessoal de cliente nem de colaborador — mesmo
-- tratamento já dado a pix_recipient_name (sem máscara): útil no
-- histórico para explicar "o que mudou e para quê" sem precisar reabrir
-- Configurações. Nenhuma coluna de nenhum dos 3 branches novos é
-- token/secret/credential/senha.
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
  elsif tg_op = 'UPDATE'
        and (
          old.logo_url is distinct from new.logo_url
          or old.primary_color is distinct from new.primary_color
          or old.secondary_color is distinct from new.secondary_color
          or old.storefront_template is distinct from new.storefront_template
        )
  then
    perform private.log_audit(
      new.id, 'TENANT_APPEARANCE_UPDATED', 'tenant', new.id::text,
      jsonb_build_object(
        'logo_url', old.logo_url, 'primary_color', old.primary_color,
        'secondary_color', old.secondary_color, 'storefront_template', old.storefront_template
      ),
      jsonb_build_object(
        'logo_url', new.logo_url, 'primary_color', new.primary_color,
        'secondary_color', new.secondary_color, 'storefront_template', new.storefront_template
      )
    );
  elsif tg_op = 'UPDATE' and old.checkout_mode is distinct from new.checkout_mode then
    perform private.log_audit(
      new.id, 'TENANT_CHECKOUT_MODE_UPDATED', 'tenant', new.id::text,
      jsonb_build_object('checkout_mode', old.checkout_mode),
      jsonb_build_object('checkout_mode', new.checkout_mode)
    );
  elsif tg_op = 'UPDATE'
        and (
          old.address_zip is distinct from new.address_zip
          or old.address_street is distinct from new.address_street
          or old.address_number is distinct from new.address_number
          or old.address_complement is distinct from new.address_complement
          or old.address_neighborhood is distinct from new.address_neighborhood
          or old.address_city is distinct from new.address_city
          or old.address_state is distinct from new.address_state
        )
  then
    perform private.log_audit(
      new.id, 'TENANT_ADDRESS_UPDATED', 'tenant', new.id::text,
      jsonb_build_object(
        'address_zip', old.address_zip, 'address_street', old.address_street,
        'address_number', old.address_number, 'address_complement', old.address_complement,
        'address_neighborhood', old.address_neighborhood, 'address_city', old.address_city,
        'address_state', old.address_state
      ),
      jsonb_build_object(
        'address_zip', new.address_zip, 'address_street', new.address_street,
        'address_number', new.address_number, 'address_complement', new.address_complement,
        'address_neighborhood', new.address_neighborhood, 'address_city', new.address_city,
        'address_state', new.address_state
      )
    );
  end if;
  return new;
end;
$$;

-- ============================================================
-- 2) storefront_banners — nenhum trigger de auditoria existia (confirmado
--    por leitura completa de 20260817220077, que só cria set_updated_at e
--    prevent_tenant_id_change) — STOREFRONT_BANNER_CREATED / _UPDATED /
--    _DELETED
-- ============================================================
--
-- Mesmo molde exato de private.audit_shipping_method_changes
-- (20260817220049): tabela 1:N com tenant_id, INSERT/UPDATE/DELETE
-- relevantes, DELETE usa old.tenant_id (tenant_id não existe em NEW),
-- retorno coalesce(new, old). UPDATE dispara em qualquer mudança de
-- título/link/status/imagem/ordem — sem distinguir "reordenar" de "editar
-- conteúdo", mesmo tratamento incondicional já dado a
-- SHIPPING_METHOD_UPDATED (que também muda com um simples reordenar).
-- `image_path` é só o PATH no bucket tenant-media (nunca a imagem
-- binária) — mesmo raciocínio de logo_url acima.
create function private.audit_storefront_banner_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'STOREFRONT_BANNER_CREATED', 'storefront_banner', new.id::text,
      null,
      jsonb_build_object(
        'title', new.title, 'link_url', new.link_url, 'status', new.status,
        'sort_order', new.sort_order, 'image_path', new.image_path
      )
    );
  elsif tg_op = 'UPDATE' then
    perform private.log_audit(
      new.tenant_id, 'STOREFRONT_BANNER_UPDATED', 'storefront_banner', new.id::text,
      jsonb_build_object(
        'title', old.title, 'link_url', old.link_url, 'status', old.status,
        'sort_order', old.sort_order, 'image_path', old.image_path
      ),
      jsonb_build_object(
        'title', new.title, 'link_url', new.link_url, 'status', new.status,
        'sort_order', new.sort_order, 'image_path', new.image_path
      )
    );
  elsif tg_op = 'DELETE' then
    perform private.log_audit(
      old.tenant_id, 'STOREFRONT_BANNER_DELETED', 'storefront_banner', old.id::text,
      jsonb_build_object('title', old.title, 'image_path', old.image_path), null
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger audit_storefront_banner_changes
  after insert or update or delete on public.storefront_banners
  for each row
  execute function private.audit_storefront_banner_changes();
