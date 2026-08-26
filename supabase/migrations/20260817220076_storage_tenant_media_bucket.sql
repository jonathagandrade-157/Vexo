-- Sprint 1 — Fase A — bucket dedicado à mídia de identidade visual do
-- tenant (logo agora; banner entra numa fase futura, Sprint 1 21.2).
-- Nunca reaproveita `product-media` (Etapa 8): são domínios de conteúdo
-- diferentes (identidade da LOJA vs foto de PRODUTO), mesmo princípio já
-- usado para não misturar billing/payments — um bucket por domínio.
--
-- Mesmo padrão exato de 20260817220028_storage_product_media_bucket.sql,
-- só trocando bucket/path/permission key:
--   path: {tenant_id}/logo/logo.{ext} (sem segmento de entidade filha —
--         é 1 arquivo por tenant, não por produto)
--   permission: settings.update (é a mesma que já governa todo o resto
--         do "perfil da loja" em tenants — uma única permissão para todo
--         o conjunto de identidade visual, em vez de replicar o
--         create/update/delete de três permissions como em produto)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-media', 'tenant-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Bucket público de leitura por design (a logo precisa aparecer na
-- vitrine pública, mesmo motivo exato de product-media) — restrito a UM
-- bucket que só contém mídia de identidade visual de loja.
create policy "anyone can view tenant-media objects"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'tenant-media');

-- Escrita: tenant derivado do primeiro segmento do path (nunca escolhido
-- pelo cliente — quem monta o path é o Server Action), checado via
-- private.has_permission() já existente — sem sistema de autorização
-- paralelo.
create policy "tenant staff with settings.update can upload tenant-media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tenant-media'
    and private.has_permission((storage.foldername(name))[1]::uuid, 'settings.update')
  );

create policy "tenant staff with settings.update can replace tenant-media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'tenant-media' and private.has_permission((storage.foldername(name))[1]::uuid, 'settings.update'))
  with check (bucket_id = 'tenant-media' and private.has_permission((storage.foldername(name))[1]::uuid, 'settings.update'));

create policy "tenant staff with settings.update can delete tenant-media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'tenant-media' and private.has_permission((storage.foldername(name))[1]::uuid, 'settings.update'));
