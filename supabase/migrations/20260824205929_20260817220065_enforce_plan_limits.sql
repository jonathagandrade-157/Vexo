-- Etapa 16 §6/§7/§8/§9/§10 — enforcement REAL de limites de plano, no
-- servidor, atômico sob concorrência. Verificação e escrita na MESMA
-- transação (prompt §7/§8: "não fazer cria-depois-verifica"; "SELECT
-- COUNT() depois INSERT sem proteção" é exatamente o que isto evita) —
-- um trigger BEFORE INSERT roda dentro da mesma transação implícita do
-- INSERT que o disparou, então count+decisão+escrita já são atômicos por
-- padrão; o único buraco restante é DUAS transações concorrentes lendo o
-- mesmo count antes de qualquer uma commitar, fechado por
-- `pg_advisory_xact_lock` (lock por tenant+recurso, liberado
-- automaticamente no fim da transação — nunca precisa de UNLOCK manual).
--
-- private.plan_limit_value(): variante interna de private.tenant_plan_limit
-- (migration 20260817220059) SEM a guarda de autorização (is_tenant_member/
-- is_platform_admin) — propositalmente. Essa guarda existe porque
-- tenant_plan_limit é uma RPC alcançável por `authenticated` com um
-- p_tenant_id arbitrário (prompt §18: nunca vazar dado de outro tenant).
-- Aqui não há esse risco: o único chamador é o trigger abaixo, e o
-- `tenant_id` vem de NEW (a própria linha sendo inserida), nunca de um
-- parâmetro alcançável por quem chama a função — a autorização de QUEM
-- pode inserir em products/categories já é decidida antes (RLS + a
-- permission check da Server Action); este helper só decide "quantos
-- ainda cabem no plano", não "quem pode inserir".
create function private.plan_limit_value(p_tenant_id uuid, p_limit_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pl.limit_value
  from public.subscriptions s
  join public.plan_limits pl on pl.plan_id = s.plan_id and pl.limit_key = p_limit_key
  where s.tenant_id = p_tenant_id;
$$;

comment on function private.plan_limit_value(uuid, text) is
  'Etapa 16 — leitura interna (sem guarda de autorização, uso exclusivo de triggers de enforcement) do limite numérico do plano do tenant. NULL = sem subscription/limite não configurado (fail-closed); -1 = ilimitado.';

-- Produtos
create function private.enforce_products_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  -- Serializa inserts concorrentes do MESMO tenant para este recurso —
  -- outros tenants nunca esperam uns pelos outros (lock escopado por
  -- hash(tenant_id + chave), não uma trava global da tabela).
  perform pg_advisory_xact_lock(hashtext('products_limit:' || new.tenant_id::text));

  v_limit := private.plan_limit_value(new.tenant_id, 'products_limit');

  if v_limit is null then
    -- Sem subscription ou plano sem este limit_key configurado — nunca
    -- confunde com ilimitado (prompt §18, mesmo princípio de
    -- tenant_plan_limit): fecha em negado, não em aberto.
    raise exception 'PLAN_LIMIT_UNAVAILABLE'
      using errcode = 'VX010';
  end if;

  if v_limit = -1 then
    return new; -- ilimitado
  end if;

  select count(*) into v_count from public.products where tenant_id = new.tenant_id;

  if v_count >= v_limit then
    raise exception 'PRODUCTS_LIMIT_REACHED'
      using errcode = 'VX011';
  end if;

  return new;
end;
$$;

comment on function private.enforce_products_limit() is
  'Etapa 16 — BEFORE INSERT em products: bloqueia a criação além do products_limit do plano do tenant, atômico sob concorrência (pg_advisory_xact_lock). SQLSTATE VX011 = limite atingido, VX010 = sem plano/limite configurado.';

create trigger enforce_products_limit
  before insert on public.products
  for each row execute function private.enforce_products_limit();

-- Categorias — mesmo princípio exato, chave diferente.
create function private.enforce_categories_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('categories_limit:' || new.tenant_id::text));

  v_limit := private.plan_limit_value(new.tenant_id, 'categories_limit');

  if v_limit is null then
    raise exception 'PLAN_LIMIT_UNAVAILABLE'
      using errcode = 'VX010';
  end if;

  if v_limit = -1 then
    return new;
  end if;

  select count(*) into v_count from public.categories where tenant_id = new.tenant_id;

  if v_count >= v_limit then
    raise exception 'CATEGORIES_LIMIT_REACHED'
      using errcode = 'VX011';
  end if;

  return new;
end;
$$;

comment on function private.enforce_categories_limit() is
  'Etapa 16 — BEFORE INSERT em categories: bloqueia a criação além do categories_limit do plano do tenant, atômico sob concorrência. SQLSTATE VX011 = limite atingido, VX010 = sem plano/limite configurado.';

create trigger enforce_categories_limit
  before insert on public.categories
  for each row execute function private.enforce_categories_limit();
