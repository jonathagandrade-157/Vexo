-- Etapa 14 — fundação comercial: planos e recursos (prompt §1/§3/§5/§6).
--
-- `plans`/`features` NÃO são tenant-scoped (são catálogo global da VEXO,
-- geridos pelo MASTER) — diferente de toda tabela criada até aqui, que
-- sempre tinha `tenant_id`. `plan_features` é o relacionamento N:N entre
-- os dois (prompt §5: "não criar uma coluna por recurso em plans") — a
-- PRESENÇA da linha é o que libera o recurso, sem coluna booleana extra
-- (mais simples de auditar: INSERT = liberou, DELETE = removeu).
--
-- Nenhuma herança entre planos (prompt §7): PRO não é "INTERMEDIATE +
-- alguma coisa" no banco, cada plano tem seus próprios relacionamentos em
-- plan_features — permite planos personalizados no futuro sem alterar
-- esta arquitetura.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (char_length(name) between 1 and 80),
  description text,
  -- Nulo de propósito nesta etapa (prompt §4: "não definir preços
  -- reais") — o MASTER preenche depois. numeric(10,2), nunca float
  -- (dinheiro), mesmo padrão de products.price desde a Etapa 7.
  monthly_price numeric(10, 2) check (monthly_price is null or monthly_price >= 0),
  yearly_price numeric(10, 2) check (yearly_price is null or yearly_price >= 0),
  trial_days integer not null default 30 check (trial_days >= 0),
  is_active boolean not null default true,
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table public.plans is
  'Catálogo global de planos comerciais da VEXO (não tenant-scoped) — geridos exclusivamente pelo MASTER. Preços nulos até serem configurados (Etapa 14 não fixa valores).';

create index plans_is_active_idx on public.plans (is_active);

create table public.features (
  id uuid primary key default gen_random_uuid(),
  -- snake_case (ex.: 'custom_domain', 'vexo_ai') — é a chave estável que
  -- o código usa (tenant_has_feature(tenant_id, 'coupons')), nunca o
  -- `name` de exibição, que pode mudar livremente.
  key text not null unique,
  name text not null check (char_length(name) between 1 and 80),
  description text,
  -- Agrupamento livre para a UI do MASTER (ex.: 'catalog', 'marketing',
  -- 'customization') — sem tabela de categorias própria: não há
  -- necessidade de FK/CRUD para isto nesta etapa, um texto simples já
  -- resolve a organização visual pedida no prompt §18.
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint features_key_format check (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$')
);

comment on table public.features is
  'Catálogo global de recursos/features da VEXO (não tenant-scoped) — extensível sem migration estrutural nova (prompt §25): cadastrar um recurso novo é um INSERT, nunca uma coluna nova.';

create index features_is_active_idx on public.features (is_active);

create table public.plan_features (
  plan_id uuid not null references public.plans (id) on delete cascade,
  feature_id uuid not null references public.features (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (plan_id, feature_id)
);

comment on table public.plan_features is
  'Relacionamento N:N plano↔recurso (prompt §6) — a presença da linha É a liberação do recurso para aquele plano, sem coluna booleana redundante.';

alter table public.plans enable row level security;
alter table public.plans force row level security;
alter table public.features enable row level security;
alter table public.features force row level security;
alter table public.plan_features enable row level security;
alter table public.plan_features force row level security;

create trigger set_updated_at before update on public.plans
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.features
  for each row execute function private.set_updated_at();

-- Leitura: qualquer usuário autenticado vê planos/recursos ATIVOS (é
-- catálogo comercial, não dado sensível — precisa ser visível para a UI
-- de upgrade do painel do lojista, prompt §20/§21). Rascunho/inativo só
-- para o MASTER. Escrita: exclusivamente MASTER (prompt §26: "somente
-- platform admin pode gerenciar planos/recursos"; role MASTER
-- especificamente, não SUPPORT_AGENT — private.is_platform_master(),
-- migration seguinte).
create policy "authenticated can view active plans, master sees all"
  on public.plans for select
  to authenticated
  using (is_active or private.is_platform_master());

create policy "only master can insert plans"
  on public.plans for insert
  to authenticated
  with check (private.is_platform_master());

create policy "only master can update plans"
  on public.plans for update
  to authenticated
  using (private.is_platform_master())
  with check (private.is_platform_master());

create policy "authenticated can view active features, master sees all"
  on public.features for select
  to authenticated
  using (is_active or private.is_platform_master());

create policy "only master can insert features"
  on public.features for insert
  to authenticated
  with check (private.is_platform_master());

create policy "only master can update features"
  on public.features for update
  to authenticated
  using (private.is_platform_master())
  with check (private.is_platform_master());

-- plan_features: leitura pareada com a visibilidade do plano referenciado
-- (um plano inativo/rascunho não deve vazar quais recursos ele teria).
-- Escrita (INSERT liga um recurso, DELETE desliga) só MASTER — é
-- exatamente a tela do prompt §19 ("Salvar isso no banco. Não
-- hardcodar.").
create policy "authenticated can view plan_features of visible plans"
  on public.plan_features for select
  to authenticated
  using (
    private.is_platform_master()
    or exists (select 1 from public.plans p where p.id = plan_id and p.is_active)
  );

create policy "only master can insert plan_features"
  on public.plan_features for insert
  to authenticated
  with check (private.is_platform_master());

create policy "only master can delete plan_features"
  on public.plan_features for delete
  to authenticated
  using (private.is_platform_master());
