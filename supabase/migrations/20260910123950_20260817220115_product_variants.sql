-- D20.2 — Product Variants (arquitetura D20 já aprovada em discovery,
-- D20.1 já commitada/publicada em main como product_options/
-- product_option_values, ainda NÃO aplicada em produção Supabase). Cria
-- SOMENTE product_variants e product_variant_options. Nenhuma alteração
-- em product_inventory/carts/cart_items/orders/order_items/
-- create_order_from_cart/update_order_status/add_to_cart — isso pertence
-- a D20.3+. Migration puramente aditiva, sem backfill.
--
-- Reaproveita os padrões já existentes (nenhuma arquitetura de segurança
-- nova): RLS staff gated por has_permission(tenant_id, 'products.<ação>')
-- (mesmas 3 permission keys de sempre, nenhuma nova), triggers genéricos
-- private.set_updated_at/private.prevent_tenant_id_change, padrão
-- prevent_cross_tenant_* já repetido em categories/product_inventory/
-- cart_items/product_options/product_option_values, e o mesmo filtro
-- público de duas camadas (produto ativo + tenant não suspenso/excluído).

-- ---------------------------------------------------------------------
-- Helper: canonicidade do array de identidade (D20 arquitetura §C) — sem
-- hash, um array uuid[] ordenado ascendentemente e sem duplicata é a
-- própria identidade da combinação. Função pura (sem acesso a tabela),
-- por isso SEM security definer (nada a elevar) — só search_path=''
-- por consistência com o resto do projeto, ainda que aqui não haja
-- referência não-qualificada nenhuma para sequestrar.
-- ---------------------------------------------------------------------
create function private.is_canonical_option_value_ids(arr uuid[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select arr = array(select unnest(arr) order by 1)
     and cardinality(arr) = (select count(distinct v) from unnest(arr) v);
$$;

comment on function private.is_canonical_option_value_ids(uuid[]) is
  'D20.2 — true quando arr está ordenado ascendentemente e não tem elementos duplicados. Usada em CHECK de product_variants.option_value_ids: um CHECK de tabela não pode conter subquery diretamente, mas pode chamar uma função que a contenha.';

-- ---------------------------------------------------------------------
-- product_variants
-- ---------------------------------------------------------------------
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  product_id uuid not null references public.products (id) on delete cascade,
  sku text,
  price numeric(10, 2) not null check (price >= 0),
  promotional_price numeric(10, 2) check (promotional_price >= 0),
  -- D20 arquitetura §A/§C — identidade da variante. Sem hash: o próprio
  -- array ordenado é a chave de identidade, comparável nativamente pelo
  -- operador de igualdade/ordenação de arrays do Postgres (índice btree
  -- padrão). cardinality<=3 é o único limite de combinação enforçado
  -- nesta migration (barato, por linha, sem contagem cruzada de tabela —
  -- ver nota "LIMITES" abaixo sobre os outros dois limites da
  -- arquitetura, deliberadamente NÃO implementados aqui).
  option_value_ids uuid[] not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_promo_not_above_price
    check (promotional_price is null or promotional_price <= price),
  constraint product_variants_sku_format
    check (sku is null or (sku <> '' and sku = trim(sku))),
  constraint product_variants_option_value_ids_not_empty
    check (cardinality(option_value_ids) > 0),
  constraint product_variants_option_value_ids_max_three
    check (cardinality(option_value_ids) <= 3),
  constraint product_variants_option_value_ids_canonical
    check (private.is_canonical_option_value_ids(option_value_ids)),
  -- Unicidade da combinação (D20 arquitetura §C) — arrays uuid[] têm
  -- operador de igualdade/ordenação nativo (btree), então UNIQUE funciona
  -- diretamente sobre a coluna array, sem precisar de hash/expressão.
  -- product_id como coluna líder também cobre o padrão de acesso
  -- "variantes de um produto" — nenhum índice extra em product_id é
  -- necessário (evita duplicar índice implícito, mesma decisão já
  -- tomada em D20.1).
  constraint product_variants_product_combination_unique
    unique (product_id, option_value_ids)
);

comment on table public.product_variants is
  'D20.2 — uma unidade comercial vendável específica de um produto (ex.: "Camiseta, Preto, M"). option_value_ids é a fonte de identidade da combinação (arquitetura D20 §A/§C); product_variant_options é a representação normalizada derivada dela, mantida automaticamente pelo trigger sync_product_variant_options — nunca escrita diretamente pela aplicação.';
comment on column public.product_variants.option_value_ids is
  'Array ORDENADO ASCENDENTE e SEM duplicatas de product_option_values.id (CHECK product_variants_option_value_ids_canonical) — nunca confiado como veio do chamador sem essa forma canônica. Cada elemento é validado (existência, mesmo tenant, opção pertencente ao mesmo product_id) pelo trigger validate_product_variant_option_values antes de qualquer INSERT/UPDATE ser aceito.';
comment on column public.product_variants.sku is
  'Opcional, case-sensitive (nunca normalizado para lowercase — decisão explícita da arquitetura D20.2, diferente do e-mail em customers). Unicidade por tenant via índice único parcial abaixo (sku pode repetir entre tenants, nunca dentro do mesmo tenant).';

-- SKU único por tenant, só quando informado (mesma técnica de índice
-- único parcial já usada em customers_tenant_phone_unique_no_email,
-- D19.2.2 H1, e nos dois índices de D20.1).
create unique index product_variants_tenant_sku_unique
  on public.product_variants (tenant_id, sku)
  where sku is not null;

create trigger set_updated_at
  before update on public.product_variants
  for each row
  execute function private.set_updated_at();

create trigger prevent_tenant_id_change
  before update on public.product_variants
  for each row
  execute function private.prevent_tenant_id_change();

-- Mesma lacuna que prevent_cross_tenant_product_option (D20.1) já fecha
-- para product_options: uma FK simples em product_id só garante que o
-- produto existe, nunca que pertence ao MESMO tenant_id desta linha.
create function private.prevent_cross_tenant_product_variant()
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
      'product_variants.product_id must belong to the same tenant as product_variants.tenant_id'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

create trigger prevent_cross_tenant_product_variant
  before insert or update on public.product_variants
  for each row
  execute function private.prevent_cross_tenant_product_variant();

-- Validação profunda da combinação (D20 arquitetura §C/"VALIDAÇÃO DA
-- COMBINAÇÃO") — o que uma FK/CHECK simples não consegue expressar
-- sozinha: cada option_value_id em option_value_ids precisa (a) existir,
-- (b) pertencer ao MESMO tenant_id da variante, (c) sua opção
-- (product_option_values.product_option_id -> product_options) precisa
-- pertencer ao MESMO product_id da variante, e (d) nenhum par de
-- elementos pode pertencer à MESMA product_option (dois valores de "Cor"
-- na mesma variante é sempre inválido). Roda em TODO insert/update (não
-- só quando option_value_ids muda) — um UPDATE que troca só product_id
-- também precisa revalidar que os valores já gravados continuam
-- pertencendo ao produto novo.
create function private.validate_product_variant_option_values()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invalid_count integer;
  v_distinct_options integer;
  v_value_count integer;
begin
  v_value_count := cardinality(new.option_value_ids);

  select count(*) into v_invalid_count
  from unnest(new.option_value_ids) as ov_id
  where not exists (
    select 1
    from public.product_option_values pov
    join public.product_options po on po.id = pov.product_option_id
    where pov.id = ov_id
      and pov.tenant_id = new.tenant_id
      and po.product_id = new.product_id
  );

  if v_invalid_count > 0 then
    raise exception
      'product_variants.option_value_ids contains a value that does not exist, or does not belong to the same product/tenant as the variant'
      using errcode = '23514'; -- check_violation
  end if;

  select count(distinct pov.product_option_id) into v_distinct_options
  from public.product_option_values pov
  where pov.id = any(new.option_value_ids);

  if v_distinct_options <> v_value_count then
    raise exception
      'product_variants.option_value_ids cannot contain two values from the same product_option'
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$$;

create trigger validate_product_variant_option_values
  before insert or update on public.product_variants
  for each row
  execute function private.validate_product_variant_option_values();

alter table public.product_variants enable row level security;
alter table public.product_variants force row level security;

-- Staff do painel: mesmas permission keys de products (products.view/
-- products.update/products.delete) — nenhuma permission key nova.
create policy "tenant staff with products.view can select product variants"
  on public.product_variants for select
  to authenticated
  using (private.has_permission(tenant_id, 'products.view') or private.is_platform_admin());

create policy "tenant staff with products.update can insert product variants"
  on public.product_variants for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.update can update product variants"
  on public.product_variants for update
  to authenticated
  using (private.has_permission(tenant_id, 'products.update'))
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.delete can delete product variants"
  on public.product_variants for delete
  to authenticated
  using (private.has_permission(tenant_id, 'products.delete'));

-- anon (storefront público): mesmo filtro de duas camadas de D20.1, mais
-- is_active=true (variante desativada não deve aparecer publicamente —
-- mesma decisão já registrada na arquitetura D20 §E, nunca alargada para
-- authenticated). Sem NENHUMA policy de escrita para anon.
create policy "anyone can view active variants of active products of publicly visible tenants"
  on public.product_variants for select
  to anon
  using (
    is_active
    and exists (
      select 1 from public.products p
      join public.tenants t on t.id = p.tenant_id
      where p.id = product_variants.product_id
        and p.status = 'active'
        and t.status not in ('suspended', 'deleted')
    )
  );

-- Nenhum GRANT explícito de tabela é necessário (mesma nota de D20.1) —
-- herdado via `alter default privileges` (migration 20260817220067); RLS
-- acima é a única autoridade real.

-- ---------------------------------------------------------------------
-- product_variant_options — representação NORMALIZADA, DERIVADA de
-- product_variants.option_value_ids (fonte de identidade). Mantida
-- inteiramente pelo trigger sync_product_variant_options abaixo, dentro
-- da MESMA transação que grava/altera option_value_ids — nunca um job
-- assíncrono, nunca escrita diretamente pela aplicação (por isso não tem
-- NENHUMA policy de INSERT/UPDATE/DELETE para authenticated: sem policy
-- de escrita = RLS nega por padrão, mesmo padrão já usado para
-- roles/permissions, "só uma migration/trigger SECURITY DEFINER pode
-- alterar"). Isso garante estruturalmente que as duas nunca divergem —
-- não existem dois caminhos de escrita para desincronizar.
-- ---------------------------------------------------------------------
create table public.product_variant_options (
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  product_option_value_id uuid not null references public.product_option_values (id) on delete restrict,
  tenant_id uuid not null references public.tenants (id),
  primary key (variant_id, product_option_value_id)
);

comment on table public.product_variant_options is
  'D20.2 — representação normalizada (para consulta/filtro) de quais product_option_values compõem uma product_variants. Inteiramente DERIVADA de product_variants.option_value_ids pelo trigger sync_product_variant_options — nunca escrita diretamente (sem policy de INSERT/UPDATE/DELETE para authenticated). on delete restrict em product_option_value_id: impede apagar um valor de opção ainda usado por uma variante viva (protege identidade/histórico de variante, arquitetura D20 §M) — combinado com o on delete cascade de D20.1 (product_option_values -> product_options), isso também bloqueia a exclusão de uma product_options ou de um products inteiro enquanto uma variante viva usar algum de seus valores (a cascata para no RESTRICT).';

-- Necessário para o ON DELETE RESTRICT (acima) e para o próprio trigger
-- de sincronização conseguirem localizar eficientemente "quais linhas
-- usam este product_option_value_id" sem varredura completa — a PK
-- (variant_id, product_option_value_id) tem variant_id como coluna
-- líder, não cobre buscas por product_option_value_id sozinho.
create index product_variant_options_option_value_id_idx
  on public.product_variant_options (product_option_value_id);

-- Mesmo padrão de prevent_cross_tenant_product_variant acima — defesa em
-- profundidade mesmo esta tabela sendo só escrita por um trigger SECURITY
-- DEFINER: garante que variant_id e product_option_value_id pertencem
-- ambos ao MESMO tenant_id desta linha, independentemente de qualquer
-- futuro caminho de escrita que venha a existir.
create function private.prevent_cross_tenant_product_variant_option()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.product_variants v
    where v.id = new.variant_id and v.tenant_id = new.tenant_id
  ) then
    raise exception
      'product_variant_options.variant_id must belong to the same tenant as product_variant_options.tenant_id'
      using errcode = '23514'; -- check_violation
  end if;

  if not exists (
    select 1 from public.product_option_values pov
    where pov.id = new.product_option_value_id and pov.tenant_id = new.tenant_id
  ) then
    raise exception
      'product_variant_options.product_option_value_id must belong to the same tenant as product_variant_options.tenant_id'
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$$;

create trigger prevent_cross_tenant_product_variant_option
  before insert on public.product_variant_options
  for each row
  execute function private.prevent_cross_tenant_product_variant_option();

alter table public.product_variant_options enable row level security;
alter table public.product_variant_options force row level security;

create policy "tenant staff with products.view can select product variant options"
  on public.product_variant_options for select
  to authenticated
  using (private.has_permission(tenant_id, 'products.view') or private.is_platform_admin());

create policy "anyone can view variant options of active variants of publicly visible tenants"
  on public.product_variant_options for select
  to anon
  using (
    exists (
      select 1 from public.product_variants v
      join public.products p on p.id = v.product_id
      join public.tenants t on t.id = p.tenant_id
      where v.id = product_variant_options.variant_id
        and v.is_active
        and p.status = 'active'
        and t.status not in ('suspended', 'deleted')
    )
  );

-- Nenhuma policy de INSERT/UPDATE/DELETE para authenticated OU anon —
-- decisão deliberada (ver comentário da tabela acima). Nenhum GRANT
-- explícito adicional necessário.

-- ---------------------------------------------------------------------
-- Sincronização — a ÚNICA escrita em product_variant_options. Roda DEPOIS
-- que product_variants.option_value_ids já foi validado (trigger BEFORE
-- validate_product_variant_option_values) e persistido. Remove vínculos
-- que não estão mais no array, insere os que faltam — idempotente,
-- síncrona, na MESMA transação (nunca um mecanismo assíncrono).
-- DELETE de product_variants não precisa de tratamento aqui: já é
-- coberto pelo ON DELETE CASCADE de product_variant_options.variant_id.
-- ---------------------------------------------------------------------
create function private.sync_product_variant_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.product_variant_options
  where variant_id = new.id
    and product_option_value_id <> all(new.option_value_ids);

  insert into public.product_variant_options (variant_id, product_option_value_id, tenant_id)
  select new.id, ov_id, new.tenant_id
  from unnest(new.option_value_ids) as ov_id
  on conflict (variant_id, product_option_value_id) do nothing;

  return new;
end;
$$;

create trigger sync_product_variant_options
  after insert or update of option_value_ids on public.product_variants
  for each row
  execute function private.sync_product_variant_options();

-- ---------------------------------------------------------------------
-- LIMITES (arquitetura D20 §N: máx. 3 opções/produto, máx. 20 valores/
-- opção, máx. 100 variantes/produto) — decisão de escopo, documentada
-- conforme pedido no ticket D20.2 em vez de implementada:
--
--   - cardinality(option_value_ids) <= 3 (constraint
--     product_variants_option_value_ids_max_three acima) É implementado
--     nesta migration: é uma checagem barata, por linha, sem contagem
--     cruzada de tabela — o mesmo espírito do limite "máx. 3
--     opções/produto" aplicado onde ele é comprovável sem custo (uma
--     variante nunca pode referenciar mais de 3 opções distintas, já que
--     cada elemento pertence a uma opção diferente por construção do
--     trigger validate_product_variant_option_values acima).
--
--   - "máx. 3 opções por produto" e "máx. 20 valores por opção" são
--     limites sobre CONTAGEM de linhas em product_options/
--     product_option_values (tabelas de D20.1) — fora do escopo desta
--     migration ("product_variants"), e a própria D20.1 não pode ser
--     alterada por instrução explícita deste ticket. Exigiriam um novo
--     trigger BEFORE INSERT com COUNT(*) sobre essas tabelas (mesma
--     classe de mecanismo de private.enforce_products_limit, Etapa 16,
--     mas não ligado a plano/assinatura) — não implementado aqui.
--
--   - "máx. 100 variantes por produto" também exigiria um trigger BEFORE
--     INSERT com COUNT(*) sobre product_variants — mesma classe de
--     mecanismo, também não implementado aqui.
--
-- Nenhum dos dois itens acima é implementado nesta migration: são
-- enforcement baseado em contagem entre linhas (não expressável como
-- CHECK de linha única) e introduziriam uma nova classe de trigger fora
-- do que este ticket autorizou explicitamente ("NÃO inventar solução...
-- manter o escopo controlado"). Ficam documentados aqui como decisão
-- pendente para uma etapa dedicada futura (mesmo padrão de Etapa 16 ter
-- sido sua própria etapa de discovery+implementação, não bundlada em
-- outra migration).
