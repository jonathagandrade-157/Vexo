-- D19.2.3 — Customers Foundation (D19.2.1 discovery + D19.2.2 independent
-- review, "APPROVED WITH CHANGES"). SOMENTE a fundação de banco: tabela
-- `customers`, RLS, trigger de proteção cross-tenant e a coluna
-- `orders.customer_id`. Nenhuma escrita de dado, nenhum backfill, nenhuma
-- alteração em create_order_from_cart/update_order_status — a resolução
-- de cliente dentro do checkout é escopo do D19.2.4, uma etapa futura e
-- separada.
--
-- Duas correções do D19.2.2 já incorporadas aqui (não uma reinterpretação
-- livre — literalmente o que a revisão exigiu antes de qualquer código):
--   H1 — UNIQUE(tenant_id, phone) incondicional foi REJEITADA: colidiria
--     entre um customer identificado por e-mail e outro por telefone que
--     por acaso compartilham o mesmo número (número reciclado, aparelho
--     compartilhado). Em vez disso, um ÍNDICE ÚNICO PARCIAL
--     (WHERE email IS NULL) garante unicidade de telefone só entre
--     customers que NÃO têm e-mail — o único grupo em que telefone é de
--     fato a chave de identidade.
--   H2 — NENHUM trigger de auditoria automática nesta migration. A
--     criação de customer, quando implementada (D19.2.4), acontecerá
--     como `anon` dentro de create_order_from_cart; private.log_audit()
--     rejeita eventos de um ator que não é membro do tenant/platform
--     admin/service_role — um trigger incondicional em INSERT quebraria
--     o checkout inteiro (mesma classe de armadilha já corrigida para
--     product_inventory no D19.1.2, mas aqui no próprio INSERT, não só
--     no UPDATE).

-- ---------------------------------------------------------------------
-- 1. Tabela customers
-- ---------------------------------------------------------------------
-- Sem cpf/document_hash (CPF fora do MVP, decisão explícita do D19.2.1
-- confirmada no D19.2.2) e sem nenhum campo especulativo. `email`/`phone`
-- nullable de propósito (D19.2.1 §Fase 4: nunca assumir que um dos dois
-- sempre existe) — a normalização (trim/lowercase de e-mail, E.164 de
-- telefone) é responsabilidade da aplicação; os CHECKs abaixo são só a
-- segunda camada de defesa (mesmo princípio de
-- product_inventory.stock_quantity >= 0, D19.1.2: nunca confiar só na
-- camada de aplicação para uma invariante de dado).
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null check (char_length(name) > 0),
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Nunca string vazia (a aplicação deve converter '' para NULL antes de
  -- gravar), sempre já em minúsculas e sem espaço nas extremidades —
  -- rejeita qualquer valor que a normalização da aplicação eventualmente
  -- falhe em aplicar. D19.3 (achado MEDIUM): a versão original só
  -- checava lower(email) = email, sem checar trim — um valor como
  -- ' user@teste.com ' passava pelo CHECK e coexistia, sem violar
  -- customers_tenant_email_unique, com a versão limpa 'user@teste.com'
  -- do mesmo e-mail no mesmo tenant, quebrando a garantia de
  -- deduplicação que a UNIQUE existe para oferecer. email = lower(trim(email))
  -- cobre lowercase E trim numa única condição. Não é um validador
  -- completo de e-mail — 'user @teste.com' (espaço interno) continua
  -- passando, de propósito (mesmo escopo do CHECK de telefone: garantir
  -- a forma canônica esperada, não uma biblioteca de validação).
  constraint customers_email_normalized_check check (
    email is null or (email <> '' and email = lower(trim(email)))
  ),
  -- Formato E.164 básico: '+' seguido de 7 a 15 dígitos, primeiro dígito
  -- nunca zero (mesma forma do exemplo do ticket: +5511999999999). Não é
  -- uma biblioteca de validação de telefonia (não confere DDD/operadora/
  -- plausibilidade por país) — só garante a forma canônica esperada,
  -- exatamente como pedido.
  constraint customers_phone_e164_check check (
    phone is null or (phone <> '' and phone ~ '^\+[1-9][0-9]{6,14}$')
  ),
  -- Dois NULL nunca colidem em UNIQUE (comportamento padrão do
  -- PostgreSQL) — dois customers sem e-mail no mesmo tenant continuam
  -- permitidos por esta constraint (a identidade deles, quando possível,
  -- é resolvida por telefone via o índice parcial abaixo). E-mails reais
  -- normalizados não podem duplicar dentro do MESMO tenant; o mesmo
  -- e-mail em tenants diferentes é permitido (isolamento SaaS).
  constraint customers_tenant_email_unique unique (tenant_id, email)
);

comment on table public.customers is
  'D19.2.3 — fundação de banco do Customers/CRM (D19.2.1/D19.2.2). Entidade separada de orders: representa "quem é este cliente HOJE" (mutável), nunca substitui os snapshots imutáveis de orders.customer_name/email/phone ("o que aconteceu NESTE pedido"). Nenhuma escrita ainda acontece nesta tabela — a resolução/criação dentro do checkout é escopo do D19.2.4.';
comment on column public.customers.email is
  'Nullable — nunca assumir que todo customer tem e-mail (D19.2.1 §Fase 4). Normalizado (trim+lowercase, string vazia vira NULL) pela aplicação; customers_email_normalized_check é a segunda camada de defesa contra um valor não normalizado chegar ao banco.';
comment on column public.customers.phone is
  'Nullable, formato canônico E.164 (+5511999999999) quando presente. Normalizado pela aplicação; customers_phone_e164_check é a segunda camada de defesa, não uma validação completa de telefonia.';
comment on column public.customers.status is
  'Soft archive (mesmo padrão de products.status/categories.status/tenants.status) — nunca exclusão física. Sem policy de DELETE nesta tabela (ver seção de RLS abaixo).';

create index customers_tenant_id_idx on public.customers (tenant_id);

-- H1 (D19.2.2) — unicidade de telefone só entre customers SEM e-mail.
-- Um customer identificado por e-mail nunca colide com outro customer
-- (com e-mail diferente) que por acaso compartilhe o mesmo telefone —
-- cenário real (número reciclado, aparelho compartilhado) que uma
-- UNIQUE(tenant_id, phone) incondicional quebraria (ou forçaria um merge
-- silencioso de identidades, pior ainda). Só quando NENHUM dos dois
-- customers tem e-mail é que telefone passa a ser, de fato, a única
-- chave de identidade disponível, e aí a unicidade faz sentido.
create unique index customers_tenant_phone_unique_no_email
  on public.customers (tenant_id, phone)
  where email is null;

comment on index public.customers_tenant_phone_unique_no_email is
  'D19.2.2 (H1) — unicidade de telefone só entre customers sem e-mail. Nunca uma UNIQUE(tenant_id, phone) incondicional (rejeitada explicitamente na revisão): colidiria entre customers identificados por e-mail que compartilham um telefone (número reciclado, aparelho compartilhado), ou forçaria merge acidental de identidades diferentes.';

-- Reaproveita os triggers genéricos já usados por toda tabela mutável
-- tenant-scoped do projeto (products, categories, cart_items,
-- product_inventory, ...) — nenhuma arquitetura paralela.
create trigger set_updated_at
  before update on public.customers
  for each row
  execute function private.set_updated_at();

create trigger prevent_tenant_id_change
  before update on public.customers
  for each row
  execute function private.prevent_tenant_id_change();

-- ---------------------------------------------------------------------
-- RLS — zero policy para `anon` (D19.2.2 §10, ticket §8): diferente de
-- carts/cart_items (que precisam de anon porque parte do acesso é
-- SECURITY INVOKER), customers segue o padrão de orders/order_items —
-- 100% do acesso de escrita acontecerá através de uma função SECURITY
-- DEFINER (create_order_from_cart, D19.2.4, ainda não implementada nesta
-- etapa). Nenhum comprador consegue SELECT/INSERT/UPDATE/DELETE
-- diretamente em customers por nenhum caminho.
alter table public.customers enable row level security;
alter table public.customers force row level security;

-- Reutiliza customers.view/customers.update, já existentes desde a
-- migration 20260817220003 (Etapa 2) e já corretamente distribuídas
-- (OWNER/ADMIN/MANAGER: view+update; OPERATOR: só view; SUPPORT:
-- nenhuma) — nenhuma permission key nova.
create policy "tenant staff with customers.view can select customers"
  on public.customers for select
  to authenticated
  using (private.has_permission(tenant_id, 'customers.view') or private.is_platform_admin());

create policy "tenant staff with customers.update can insert customers"
  on public.customers for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'customers.update'));

create policy "tenant staff with customers.update can update customers"
  on public.customers for update
  to authenticated
  using (private.has_permission(tenant_id, 'customers.update'))
  with check (private.has_permission(tenant_id, 'customers.update'));

-- Sem policy de DELETE (soft archive via status — ticket §5): RLS nega
-- por padrão quando não há policy, então DELETE fica bloqueado para
-- todo mundo, inclusive staff, sem precisar de nenhuma checagem extra.

-- Nenhum GRANT explícito de tabela é necessário — mesmo raciocínio já
-- registrado em product_inventory (20260817220109): `customers` é criada
-- rodando como `postgres`, herda automaticamente select/insert/update/
-- delete para anon/authenticated/service_role via `alter default
-- privileges` (migration 20260817220067); RLS acima é a única
-- autoridade real sobre quais linhas cada papel alcança — e para `anon`,
-- sem nenhuma policy, o resultado é sempre zero linhas em qualquer
-- operação.

-- ---------------------------------------------------------------------
-- 2. orders.customer_id — nullable, sem nenhum backfill nesta etapa.
-- ---------------------------------------------------------------------
-- Nenhuma outra coluna de orders é tocada. Os snapshots customer_name/
-- customer_email/customer_phone permanecem exatamente como estão — este
-- ponteiro representa "qual customer HOJE corresponde a este pedido",
-- nunca substitui o registro histórico do que o pedido continha no
-- momento da compra. ON DELETE SET NULL: excluir/arquivar um customer
-- nunca apaga nem invalida um pedido — o pedido só perde o ponteiro,
-- todo o snapshot permanece intacto.
alter table public.orders
  add column customer_id uuid references public.customers (id) on delete set null;

comment on column public.orders.customer_id is
  'D19.2.3 — ponteiro opcional para o customer atual (D19.2, fundação de banco). NULL em todo pedido existente (nenhum backfill nesta etapa) e em todo pedido novo até o D19.2.4 implementar a resolução dentro de create_order_from_cart. Nunca substitui customer_name/customer_email/customer_phone (snapshot imutável do pedido) — customer_id aponta para "quem é esse cliente hoje", os campos de snapshot registram "o que este pedido continha no momento da compra".';

create index orders_customer_id_idx on public.orders (customer_id);

-- ---------------------------------------------------------------------
-- 3. Proteção cross-tenant orders → customers (D19.2.2 §7/§12) —
-- necessária mesmo com a FK correta: uma FK simples em customer_id só
-- garante que o customer existe, nunca que pertence ao MESMO tenant do
-- pedido (mesma lacuna que prevent_cross_tenant_product_inventory,
-- prevent_cross_tenant_category, prevent_cross_tenant_cart_item já
-- fecham para suas respectivas relações). Funciona também dentro de
-- qualquer caminho SECURITY DEFINER (create_order_from_cart, D19.2.4,
-- ou update_order_status) porque é um trigger de tabela, não uma RLS —
-- dispara sempre, independentemente de quem/o que está escrevendo.
create function private.prevent_cross_tenant_order_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.tenant_id = new.tenant_id
  ) then
    raise exception
      'orders.customer_id must belong to the same tenant as orders.tenant_id'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

comment on function private.prevent_cross_tenant_order_customer() is
  'D19.2.3 (D19.2.2 §7/§12) — impede orders.customer_id apontar para um customer de outro tenant, mesmo com a FK correta (que só garante que o customer existe, não que pertence ao mesmo tenant). orders.customer_id = NULL sempre passa sem checagem — pedidos sem customer continuam válidos.';

create trigger prevent_cross_tenant_order_customer
  before insert or update on public.orders
  for each row
  execute function private.prevent_cross_tenant_order_customer();
