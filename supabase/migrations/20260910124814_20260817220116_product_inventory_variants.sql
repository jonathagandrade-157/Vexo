-- D20.3 — Adapta product_inventory (D19.1.2) para suportar estoque por
-- variante (D20.2 já publicada em main, ainda NÃO aplicada em produção
-- Supabase). Migration puramente aditiva/adaptativa: nenhuma linha
-- existente é tocada (não há dado real ainda, mas o princípio vale de
-- qualquer forma), nenhum backfill, nenhuma variante criada
-- automaticamente. product_id continua NOT NULL e sempre preenchido —
-- variant_id é a única coluna nova, sempre NULL para produto simples
-- (comportamento de hoje 100% preservado nesse caso).
--
-- Não altera product_variants/product_options/product_option_values/
-- cart_items/orders/order_items/create_order_from_cart/
-- update_order_status — nenhuma dessas é tocada nesta migration.
--
-- Reaproveita os padrões já existentes (nenhuma arquitetura nova):
-- índice único parcial para "uma linha por chave, condicionalmente"
-- (mesma técnica de D20.1/D20.2), trigger prevent_cross_tenant_* já
-- existente ESTENDIDO (CREATE OR REPLACE, não substituído por um novo)
-- para cobrir a validação adicional de variant_id, e o trigger de
-- auditoria já existente ESTENDIDO para incluir variant_id no payload.

-- ---------------------------------------------------------------------
-- Coluna nova
-- ---------------------------------------------------------------------
alter table public.product_inventory
  add column variant_id uuid references public.product_variants (id) on delete cascade;

comment on column public.product_inventory.variant_id is
  'D20.3 — NULL para produto simples (comportamento de D19.1.2 preservado integralmente); preenchido para estoque controlado POR VARIANTE. on delete cascade: mesma lógica já aplicada a product_id — estoque não tem sentido sem a variante que ele descreve. Nunca preenchido automaticamente por esta migration (sem backfill, sem criação de variante).';

-- ---------------------------------------------------------------------
-- Unicidade — substitui o UNIQUE(product_id) de D19.1.2 (1 linha por
-- produto, sempre) por dois índices únicos parciais: 1 linha por produto
-- SEM variante (comportamento de hoje, intacto) OU 1 linha por variante
-- (novo). Nunca as duas coisas ao mesmo tempo na mesma linha — a técnica
-- de índice único parcial (mesma já usada em
-- customers_tenant_phone_unique_no_email, D20.1, D20.2) é o que torna as
-- duas regras coexistirem sem um CHECK/trigger adicional.
-- ---------------------------------------------------------------------
alter table public.product_inventory drop constraint product_inventory_product_id_unique;

create unique index product_inventory_product_unique
  on public.product_inventory (product_id)
  where variant_id is null;

create unique index product_inventory_variant_unique
  on public.product_inventory (variant_id)
  where variant_id is not null;

-- ---------------------------------------------------------------------
-- Validação cross-tenant/cross-produto — ESTENDE (CREATE OR REPLACE) o
-- trigger já existente de D19.1.2, mesma função, mesmo trigger já
-- anexado (before insert or update on product_inventory), nenhum novo
-- CREATE TRIGGER necessário. Cobre os 3 estados inválidos exigidos:
-- variant_id de outro tenant, variant_id de outro product_id, e (já
-- coberto desde D19.1.2, preservado aqui) product_id de outro tenant.
create or replace function private.prevent_cross_tenant_product_inventory()
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
      'product_inventory.product_id must belong to the same tenant as product_inventory.tenant_id'
      using errcode = '23514'; -- check_violation
  end if;

  -- D20.3 — quando a linha é de estoque por variante: a variante precisa
  -- existir, pertencer ao MESMO tenant_id desta linha, E pertencer ao
  -- MESMO product_id desta linha (nunca a variante de um produto
  -- diferente, mesmo que do mesmo tenant).
  if new.variant_id is not null and not exists (
    select 1 from public.product_variants v
    where v.id = new.variant_id
      and v.tenant_id = new.tenant_id
      and v.product_id = new.product_id
  ) then
    raise exception
      'product_inventory.variant_id must belong to the same product_id and tenant_id as product_inventory.product_id/tenant_id'
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Auditoria — ESTENDE (CREATE OR REPLACE) o trigger de auditoria já
-- existente de D19.1.2, mesma função, mesmo trigger já anexado. Único
-- acréscimo: variant_id no payload de PRODUCT_STOCK_DEFINED/
-- PRODUCT_STOCK_REMOVED, ao lado de product_id (mesmo padrão, sem
-- alterar a lógica de quando cada evento é emitido nem a exclusão de
-- auth.role() = 'anon' já existente para PRODUCT_STOCK_ADJUSTED).
create or replace function private.audit_product_inventory_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'PRODUCT_STOCK_DEFINED', 'product_inventory', new.id::text,
      null,
      jsonb_build_object('product_id', new.product_id, 'variant_id', new.variant_id, 'stock_quantity', new.stock_quantity, 'low_stock_threshold', new.low_stock_threshold)
    );
  elsif tg_op = 'UPDATE' and old.stock_quantity is distinct from new.stock_quantity and auth.role() <> 'anon' then
    perform private.log_audit(
      new.tenant_id, 'PRODUCT_STOCK_ADJUSTED', 'product_inventory', new.id::text,
      jsonb_build_object('stock_quantity', old.stock_quantity), jsonb_build_object('stock_quantity', new.stock_quantity)
    );
  elsif tg_op = 'DELETE' then
    perform private.log_audit(
      old.tenant_id, 'PRODUCT_STOCK_REMOVED', 'product_inventory', old.id::text,
      jsonb_build_object('product_id', old.product_id, 'variant_id', old.variant_id, 'stock_quantity', old.stock_quantity), null
    );
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- RLS staff — NENHUMA alteração: as 4 policies de D19.1.2 (select/
-- insert/update/delete gated por products.view/products.update) checam
-- só tenant_id via has_permission, nunca product_id/variant_id
-- diretamente — continuam corretas sem modificação para linhas
-- variant_id IS NOT NULL. RLS/FORCE RLS já estavam ativas desde D19.1.2,
-- não precisam ser reafirmadas para uma coluna nova.
--
-- RLS anon — ESTENDIDA: a policy pública de D19.1.2 já filtra por
-- product_id (sempre preenchido, inclusive em linha de variante) +
-- produto ativo + tenant publicado, então já funcionaria para linhas de
-- variante sem nenhuma mudança. Ainda assim, adicionamos a exigência de
-- variant.is_active quando variant_id está preenchido — mesma decisão já
-- tomada para product_variants em D20.2 ("variante desativada não deve
-- aparecer publicamente"): sem este ajuste, o storefront poderia
-- enxergar stock_quantity de uma variante que o lojista desativou (não
-- vaza preço/nome — só a quantidade —, mas é a mesma categoria de dado
-- que D20.2 já decidiu esconder para variante inativa).
drop policy "anyone can view stock of active products of publicly visible tenants" on public.product_inventory;

create policy "anyone can view stock of active products of publicly visible tenants"
  on public.product_inventory for select
  to anon
  using (
    (variant_id is null or exists (select 1 from public.product_variants v where v.id = product_inventory.variant_id and v.is_active))
    and exists (
      select 1 from public.products p
      join public.tenants t on t.id = p.tenant_id
      where p.id = product_inventory.product_id
        and p.status = 'active'
        and t.status not in ('suspended', 'deleted')
    )
  );
