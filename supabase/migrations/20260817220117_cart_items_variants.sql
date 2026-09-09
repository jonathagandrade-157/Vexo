-- D20.4 — Adapta cart_items (Etapa 9) para suportar produto com variante
-- (D20.2/D20.3 já publicadas em main, ainda NÃO aplicadas em produção
-- Supabase). Migration puramente aditiva: nenhuma linha existente é
-- tocada, sem backfill, sem criar variante automaticamente.
--
-- product_id continua NOT NULL e sempre preenchido (denormalizado, mesmo
-- papel de sempre nesta tabela). variant_id é a única coluna nova, sempre
-- NULL para produto simples — comportamento de hoje 100% preservado
-- nesse caso.
--
-- Não altera create_order_from_cart/update_order_status/orders/
-- order_items/product_variants/product_options — nenhuma dessas é
-- tocada nesta migration (D20.5/D20.6 tratam do checkout/cancelamento).

-- ---------------------------------------------------------------------
-- Coluna nova
-- ---------------------------------------------------------------------
alter table public.cart_items
  add column variant_id uuid references public.product_variants (id) on delete cascade;

comment on column public.cart_items.variant_id is
  'D20.4 — NULL para produto simples (comportamento de Etapa 9 preservado integralmente); preenchido quando o item representa uma combinação específica de product_variants. on delete cascade: mesma lógica de product_id — item de carrinho não sobrevive à variante que ele referencia.';

-- ---------------------------------------------------------------------
-- Unicidade — substitui UNIQUE(cart_id, product_id) por dois índices
-- únicos parciais: 1 linha por produto SEM variante (comportamento de
-- hoje, intacto) OU 1 linha por variante (novo). Mesma técnica já usada
-- em D19.2.2/D20.1/D20.2/D20.3.
-- ---------------------------------------------------------------------
alter table public.cart_items drop constraint cart_items_cart_product_unique;

create unique index cart_items_cart_product_unique
  on public.cart_items (cart_id, product_id)
  where variant_id is null;

create unique index cart_items_cart_variant_unique
  on public.cart_items (cart_id, variant_id)
  where variant_id is not null;

-- ---------------------------------------------------------------------
-- Validação — ESTENDE (CREATE OR REPLACE) o trigger já existente de
-- Etapa 9, mesma função, mesmo trigger já anexado (before insert or
-- update on cart_items), nenhum novo CREATE TRIGGER necessário.
--
-- Regras novas (D20.4):
--   - variant_id, quando preenchido, precisa pertencer ao MESMO
--     product_id e tenant_id desta linha — sempre (INSERT e UPDATE),
--     mesma classe de checagem que já vale para product_id.
--   - no INSERT: a variante precisa estar is_active (mesmo espírito do
--     check "produto ativo" já existente, só para INSERT — um item já
--     no carrinho pode ser reduzido/removido mesmo se a variante for
--     desativada depois).
--   - no INSERT: se o produto TEM variantes cadastradas, variant_id é
--     obrigatório (nunca aceitar "sem escolha" de um produto que exige
--     escolha). Se o produto NÃO tem variantes, variant_id precisa ser
--     NULL (nunca um variant_id "fantasma" em produto simples).
create or replace function private.prevent_cross_tenant_cart_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_tenant uuid;
  v_product_tenant uuid;
  v_product_status text;
  v_variant_product_id uuid;
  v_variant_tenant_id uuid;
  v_variant_active boolean;
  v_product_has_variants boolean;
begin
  select tenant_id into v_cart_tenant from public.carts where id = new.cart_id;
  if v_cart_tenant is null or v_cart_tenant <> new.tenant_id then
    raise exception 'cart_items.tenant_id must match the parent cart''s tenant'
      using errcode = '23514';
  end if;

  select tenant_id, status into v_product_tenant, v_product_status
  from public.products where id = new.product_id;
  if v_product_tenant is null or v_product_tenant <> new.tenant_id then
    raise exception 'cart_items.product_id must belong to the same tenant as the cart item'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and v_product_status <> 'active' then
    raise exception 'cannot add an inactive product to the cart'
      using errcode = '23514';
  end if;

  -- D20.4 — variant_id, quando preenchido, precisa pertencer ao MESMO
  -- product_id/tenant_id desta linha, sempre (não só no INSERT: uma
  -- troca de product_id/variant_id via UPDATE também precisa revalidar).
  if new.variant_id is not null then
    select product_id, tenant_id, is_active
      into v_variant_product_id, v_variant_tenant_id, v_variant_active
    from public.product_variants where id = new.variant_id;

    if v_variant_product_id is null
      or v_variant_product_id <> new.product_id
      or v_variant_tenant_id <> new.tenant_id
    then
      raise exception 'cart_items.variant_id must belong to the same product_id and tenant_id as the cart item'
        using errcode = '23514';
    end if;

    if tg_op = 'INSERT' and not v_variant_active then
      raise exception 'cannot add an inactive variant to the cart'
        using errcode = '23514';
    end if;
  end if;

  -- D20.4 — no INSERT: produto com variantes cadastradas exige escolha
  -- (nunca aceitar "sem variante" de um produto que exige variante). Só
  -- no INSERT, mesmo raciocínio do check de produto ativo acima: um item
  -- já no carrinho não é retroativamente invalidado se o catálogo do
  -- produto mudar depois (o checkout, fora de escopo aqui, é quem
  -- revalida tudo de novo no momento da compra).
  --
  -- A direção oposta ("produto SEM variantes não aceita variant_id") não
  -- precisa de checagem própria: é logicamente coberta pelo bloco acima
  -- (`new.variant_id is not null`) — qualquer variant_id que sobreviva
  -- àquela checagem de posse necessariamente pertence a um produto que
  -- TEM ao menos essa variante, então "produto sem variantes recebendo
  -- um variant_id válido" é uma contradição, nunca um caso real a
  -- proteger separadamente.
  if tg_op = 'INSERT' and new.variant_id is null then
    select exists (
      select 1 from public.product_variants v
      where v.product_id = new.product_id
    ) into v_product_has_variants;

    if v_product_has_variants then
      raise exception 'this product requires selecting a variant'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS — NENHUMA alteração: as policies de anon de Etapa 9 (insert/
-- select/update/delete) filtram só por tenant publicado, nunca por
-- product_id/variant_id diretamente — continuam corretas sem
-- modificação para linhas variant_id IS NOT NULL. RLS/FORCE RLS já
-- estavam ativas desde Etapa 9, e GRANT de tabela já cobre a coluna
-- nova automaticamente (GRANT é por tabela, não por coluna).

-- ---------------------------------------------------------------------
-- add_to_cart — troca a assinatura (4 → 5 parâmetros: p_variant_id
-- novo). IMPORTANTE (mesmo aviso já registrado para create_order_from_cart,
-- D2-B/D19.1.2): CREATE OR REPLACE só substitui de fato uma função
-- quando a lista de TIPOS de parâmetro já existente é IDÊNTICA —
-- acrescentar um parâmetro, mesmo opcional, cria um SEGUNDO OVERLOAD em
-- vez de substituir. Isso seria um bug real aqui: o overload antigo de 4
-- parâmetros continuaria existindo com `on conflict (cart_id,
-- product_id)` SEM o `where variant_id is null` — alvo que deixou de
-- casar com o índice (agora parcial) assim que esta mesma migration o
-- recriou acima, quebrando a chamada antiga com "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification". Por
-- isso o `DROP FUNCTION` explícito abaixo, antes do `CREATE FUNCTION` —
-- garante que só a versão de 5 parâmetros exista, nunca as duas.
drop function public.add_to_cart(uuid, uuid, uuid, integer);

-- Mesma assinatura de retorno/segurança de Etapa 9 (security invoker —
-- roda como o papel que chamou, sempre anon, sujeito às MESMAS RLS/
-- trigger de uma escrita direta, nenhum bypass). Único acréscimo:
-- p_variant_id opcional (default null, preserva 100% a chamada de hoje
-- para produto simples). Dois ramos de INSERT...ON CONFLICT são
-- necessários porque cada índice único parcial exige que o alvo do ON
-- CONFLICT bata exatamente com o WHERE do índice — mesma técnica já
-- usada em customer_resolution_in_checkout (D19.2.4.1) para
-- customers_tenant_phone_unique_no_email.
create function public.add_to_cart(
  p_tenant_id uuid,
  p_cart_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_variant_id uuid default null
)
returns public.cart_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.cart_items;
begin
  if p_variant_id is not null then
    insert into public.cart_items (cart_id, tenant_id, product_id, variant_id, quantity)
    values (p_cart_id, p_tenant_id, p_product_id, p_variant_id, p_quantity)
    on conflict (cart_id, variant_id) where variant_id is not null
    do update set quantity = least(public.cart_items.quantity + excluded.quantity, 99)
    returning * into v_row;
  else
    insert into public.cart_items (cart_id, tenant_id, product_id, quantity)
    values (p_cart_id, p_tenant_id, p_product_id, p_quantity)
    on conflict (cart_id, product_id) where variant_id is null
    do update set quantity = least(public.cart_items.quantity + excluded.quantity, 99)
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

comment on function public.add_to_cart(uuid, uuid, uuid, integer, uuid) is
  'D20.4 — upsert atômico de item de carrinho, agora com variant_id opcional (null preserva 100% o comportamento de produto simples de Etapa 9). security invoker: mesma RLS/trigger de uma escrita direta, sem bypass. Dois ramos de ON CONFLICT — um por índice único parcial (cart_items_cart_product_unique/cart_items_cart_variant_unique, esta migration).';

-- DROP FUNCTION remove os grants junto com a função antiga — precisam
-- ser reafirmados explicitamente aqui, idênticos aos de Etapa 9.
revoke execute on function public.add_to_cart(uuid, uuid, uuid, integer, uuid)
  from public, authenticated, service_role;
grant execute on function public.add_to_cart(uuid, uuid, uuid, integer, uuid) to anon;
