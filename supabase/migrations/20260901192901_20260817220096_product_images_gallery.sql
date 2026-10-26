-- D13.1 — galeria de imagens de produto. `products.main_image` NÃO é
-- removido nem substituído nesta etapa (compatibilidade explícita —
-- relatório D13.0 §D/§P, prompt D13.1 §2/§16): continua existindo e
-- continua sendo o que o storefront/painel legado já lê. A partir de
-- agora ele é DERIVADO da galeria (trigger `sync_product_main_image`
-- abaixo) em vez de gravado diretamente pelas Server Actions antigas
-- (`prepareProductImageUploadAction`/`confirmProductImageUploadAction`/
-- `removeProductImageAction`, D11.8) — essas Actions continuam existindo
-- no código (não removidas, prompt §16/§22), mas `ProductForm` deixa de
-- chamá-las a partir desta etapa (só o componente de galeria nova é
-- usado na UI).
--
-- Modelagem (prompt D13.1 §2/§9): sem coluna `is_primary` — a "imagem
-- principal" é sempre a de menor `sort_order` para aquele produto (fonte
-- única de verdade), nunca um booleano paralelo que precisaria de
-- constraint/transação própria para garantir unicidade. `main_image` é
-- só um CACHE sincronizado dessa mesma fonte, mantido pelo trigger — não
-- existe um segundo lugar onde "qual é a principal" é decidido.
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Evita linha duplicada para o mesmo arquivo (também é o que torna o
  -- backfill abaixo idempotente via ON CONFLICT).
  constraint product_images_product_storage_path_unique unique (product_id, storage_path)
);

comment on table public.product_images is
  'Galeria de imagens de um produto (D13.1) — um produto pode ter 0..N linhas aqui. "Imagem principal" = a linha de menor sort_order; products.main_image é mantido em sincronia com ela pelo trigger sync_product_main_image, nunca gravado diretamente por uma Server Action nova.';
comment on column public.product_images.storage_path is
  'Path no bucket product-media (mesmo bucket de products.main_image, nunca um novo bucket) — {tenant_id}/products/{product_id}/gallery/{image_id}.{ext} para uploads novos (D13.1); imagens pré-existentes (backfill abaixo) mantêm o path antigo {tenant_id}/products/{product_id}/main.{ext}, nunca movidas/renomeadas no Storage.';
comment on column public.product_images.sort_order is
  'Ordem lógica dentro do produto — controlada só pelo servidor (reorderProductGalleryAction/setPrimaryProductGalleryImageAction), nunca por um índice de array enviado cru pelo cliente.';

create index product_images_product_id_sort_order_idx on public.product_images (product_id, sort_order);
create index product_images_tenant_id_idx on public.product_images (tenant_id);

create trigger set_updated_at
  before update on public.product_images
  for each row
  execute function private.set_updated_at();

-- Reaproveita o trigger genérico da Etapa 2 (0008) — mesmo padrão de
-- toda tabela tenant_id-scoped do projeto.
create trigger prevent_tenant_id_change
  before update on public.product_images
  for each row
  execute function private.prevent_tenant_id_change();

-- Mesma proteção de "produto do tenant A + categoria do tenant B" já
-- existente para products.category_id (migration 20260817220024,
-- private.prevent_cross_tenant_category) — aqui para
-- product_images.product_id: uma FK simples não garante que
-- tenant_id bate com o tenant do produto referenciado.
create function private.prevent_cross_tenant_product_image()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.products p
    where p.id = new.product_id and p.tenant_id = new.tenant_id
  ) then
    raise exception
      'product_images.tenant_id must match the tenant of product_id'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

create trigger prevent_cross_tenant_product_image
  before insert or update on public.product_images
  for each row
  execute function private.prevent_cross_tenant_product_image();

-- Fonte única de "qual é a principal": sempre a linha de menor
-- sort_order (empate por created_at, para determinismo). Dispara em
-- INSERT/UPDATE/DELETE — cobre upload de imagem nova, reorder, definir
-- principal (reorder que move uma linha para sort_order mínimo) e
-- exclusão (inclusive exclusão da própria principal, que já recalcula
-- para a próxima da fila, ou NULL se a galeria ficar vazia — prompt
-- D13.1 §11). SECURITY DEFINER: precisa gravar em products, que quem
-- está inserindo em product_images não necessariamente tem UPDATE
-- direto liberado por RLS sem essa elevação pontual (mesmo padrão de
-- private.prevent_cross_tenant_category).
create function private.sync_product_main_image()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_new_main text;
begin
  v_product_id := coalesce(new.product_id, old.product_id);

  select storage_path into v_new_main
  from public.product_images
  where product_id = v_product_id
  order by sort_order asc, created_at asc
  limit 1;

  update public.products set main_image = v_new_main where id = v_product_id;

  return coalesce(new, old);
end;
$$;

create trigger sync_product_main_image
  after insert or update or delete on public.product_images
  for each row
  execute function private.sync_product_main_image();

alter table public.product_images enable row level security;
alter table public.product_images force row level security;

-- RLS espelhando exatamente as policies já existentes de `products`
-- (migration 20260817220026) — mesma permission key por operação que as
-- Server Actions de imagem já usam hoje (D11.8:
-- prepare/confirmProductImageUploadAction usam 'products.update',
-- removeProductImageAction usa 'products.delete') — não INSERT com
-- 'products.create': adicionar imagem a um produto já existente é uma
-- atualização daquele produto, nunca a criação de um produto novo.
create policy "tenant staff with products.view can select product_images"
  on public.product_images for select
  to authenticated
  using (private.has_permission(tenant_id, 'products.view') or private.is_platform_admin());

create policy "tenant staff with products.update can insert product_images"
  on public.product_images for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.update can update product_images"
  on public.product_images for update
  to authenticated
  using (private.has_permission(tenant_id, 'products.update'))
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.delete can delete product_images"
  on public.product_images for delete
  to authenticated
  using (private.has_permission(tenant_id, 'products.delete'));

-- Leitura pública (storefront) — mesmo critério de menor privilégio já
-- usado para a policy anon de `products` (migration 20260817220026):
-- só imagens de um produto ativo, de um tenant publicamente visível.
create policy "anyone can view images of publicly visible active products"
  on public.product_images for select
  to anon
  using (
    exists (
      select 1 from public.products p
      join public.tenants t on t.id = p.tenant_id
      where p.id = product_images.product_id
        and p.status = 'active'
        and t.status not in ('suspended', 'deleted')
    )
  );

-- Backfill (prompt D13.1 §3) — todo produto com main_image já
-- preenchido (dado real, hoje em produção) ganha a linha correspondente
-- na galeria, no mesmo path que já existe no Storage (nada movido/
-- renomeado, nada reenviado). Idempotente via ON CONFLICT (a unique
-- constraint acima é exatamente (product_id, storage_path)) — reaplicar
-- esta migration nunca duplica a linha. Dispara o trigger
-- sync_product_main_image por linha, que recalcula products.main_image
-- para o MESMO valor que já estava lá — nenhuma alteração observável,
-- só confirma que o cache já nasce consistente com a galeria.
insert into public.product_images (tenant_id, product_id, storage_path, sort_order)
select tenant_id, id, main_image, 0
from public.products
where main_image is not null
on conflict (product_id, storage_path) do nothing;
