-- Etapa 8 — bucket de imagem de produto (arquitetura §9.1, já documentado
-- ali antes desta etapa existir; nome/path/limite/allow-list não são
-- inventados agora). Aplicada contra um projeto Supabase real, onde o
-- schema `storage` já existe com RLS habilitada por padrão em
-- `storage.objects` — por isso esta migration não faz
-- `alter table storage.objects enable row level security`, só cria
-- policies (padrão documentado do próprio Supabase). Para rodar contra o
-- Postgres puro deste sandbox (sem Supabase real disponível — Docker sem
-- daemon, ver relatório da Etapa 8), o schema `storage` é recriado de
-- forma simplificada em tests/integration/fixtures/supabase-stub.sql,
-- assim como o schema `auth` já era desde a Etapa 2.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-media', 'product-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Bucket é público de leitura por design (vitrine do storefront/SEO,
-- arquitetura §9.1) — não é a mesma situação da lição da Etapa 6
-- (RLS de `tenants`/`products`/`categories` alargada por engano para
-- `authenticated`): aqui a publicidade é intencional, documentada, e
-- restrita a UM bucket que só contém imagem de produto.
create policy "anyone can view product-media objects"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-media');

-- Escrita: tenant derivado do primeiro segmento do path
-- (`{tenant_id}/products/{product_id}/...`, nunca escolhido pelo
-- cliente — quem monta o path é o Server Action, arquitetura §9.2),
-- checado via private.has_permission() já existente (Etapa 2) — sem
-- sistema de autorização paralelo.
create policy "tenant staff can upload product-media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-media'
    and (
      private.has_permission((storage.foldername(name))[1]::uuid, 'products.create')
      or private.has_permission((storage.foldername(name))[1]::uuid, 'products.update')
    )
  );

create policy "tenant staff with products.update can replace product-media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-media' and private.has_permission((storage.foldername(name))[1]::uuid, 'products.update'))
  with check (bucket_id = 'product-media' and private.has_permission((storage.foldername(name))[1]::uuid, 'products.update'));

-- DELETE mapeado para products.delete, não products.update — mapeamento
-- explícito do prompt da Etapa 8 (§7): "para upload/alteração de imagem
-- de produto: products.create, products.update, products.delete,
-- conforme a operação".
create policy "tenant staff with products.delete can delete product-media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-media' and private.has_permission((storage.foldername(name))[1]::uuid, 'products.delete'));
