-- D17.1 — infraestrutura de banco para Multi-Domain / White-Label
-- (auditoria prévia: D17.0). Esta migration SÓ cria a tabela e a policy
-- pública de leitura — nenhuma resolução host → tenant é implementada
-- aqui (isso é D17.4+, ver relatório da D17.0).
--
-- tenant_domains é infraestrutura de ROTEAMENTO futuro, nunca uma nova
-- fonte de autorização: o fluxo futuro (host → tenant_domains → domain →
-- slug → rewrite /loja/[slug] → resolveStorefrontTenant(slug) → Supabase
-- RLS) só decide QUAL slug renderizar a partir do host — a autorização
-- real continua inteiramente em resolveStorefrontTenant() + na RLS de
-- `tenants`/`products`/`categories` (migration 20260817220022 e
-- seguintes), exatamente como já documentado em
-- docs/architecture/vexo-arquitetura-tecnica.md §3.4: "o 'resolver pelo
-- host' é a política de UX/roteamento da aplicação, a RLS é a política
-- de dados que vale independentemente da origem da chamada."
create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Globalmente único: dois tenants nunca podem reivindicar o mesmo host
  -- (isso, sozinho, já impede um domínio apontar para o tenant errado por
  -- duplicidade de linha — a verificação de posse real do domínio, via
  -- DNS/token, é responsabilidade de uma etapa futura, não desta tabela).
  domain text not null unique,
  domain_type text not null,
  is_primary boolean not null default false,
  -- Sequência prevista: pending -> verifying -> active (D17.0 §K/§M).
  -- Nenhum estado de falha/expiração é modelado ainda — decisão
  -- deliberadamente adiada para a etapa que implementar a verificação de
  -- DNS de fato (D17.3), para não especular sobre uma máquina de estados
  -- que ainda não tem implementação nenhuma por trás.
  status text not null default 'pending',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tenant_domains_domain_not_empty check (char_length(domain) > 0),
  -- Garante que o valor gravado já está normalizado — não transforma o
  -- input (isso é responsabilidade de quem grava, etapa futura), só
  -- rejeita qualquer INSERT/UPDATE que não tenha normalizado antes.
  constraint tenant_domains_domain_lowercase check (domain = lower(domain)),
  constraint tenant_domains_domain_type_valid check (domain_type in ('subdomain', 'custom')),
  constraint tenant_domains_status_valid check (status in ('pending', 'verifying', 'active'))
);

comment on table public.tenant_domains is
  'D17.1 — infraestrutura de roteamento futuro (Multi-Domain/White-Label). NUNCA uma fonte de autorização: a RLS de tenants/products/categories continua sendo a única autoridade sobre dados, independentemente do host resolvido aqui. Resolução host -> tenant_id, verificação de DNS e UI de cadastro são etapas futuras (D17.2+), não implementadas por esta migration.';
comment on column public.tenant_domains.domain is
  'Hostname completo (ex.: loja.vexo.app ou minhaloja.com.br), sempre lowercase (constraint tenant_domains_domain_lowercase). Único globalmente.';
comment on column public.tenant_domains.status is
  'pending -> verifying -> active. Só domínios "active" são visíveis via a policy pública de anon abaixo.';

-- tenant_id: toda consulta futura de "quais domínios este tenant tem"
-- (painel, etapa futura) passa por aqui.
create index tenant_domains_tenant_id_idx on public.tenant_domains (tenant_id);

-- Não cria índice separado para a resolução futura `WHERE domain = <host>
-- AND status = 'active'`: o UNIQUE(domain) acima já É um índice btree em
-- `domain` — a busca por igualdade já isola no máximo 1 linha antes do
-- filtro de `status` ser sequer avaliado. Um índice composto
-- (domain, status) não reduziria nada aqui, só adicionaria manutenção
-- sem ganho (a unicidade de `domain` já é o fator limitante).

-- No máximo um domínio primário por tenant — índice único parcial,
-- nunca um CHECK (CHECK não enxerga outras linhas da tabela).
create unique index tenant_domains_one_primary_per_tenant
  on public.tenant_domains (tenant_id)
  where is_primary;

-- RLS: habilitada e forçada (mesmo padrão de toda tabela nova do
-- projeto — força vale mesmo para o dono/service_role, embora
-- service_role tenha BYPASSRLS e não seja afetado por policy nenhuma).
alter table public.tenant_domains enable row level security;
alter table public.tenant_domains force row level security;

-- Única policy desta etapa: papel `anon` só enxerga domínios já
-- ativos — é exatamente (e só) o que uma resolução futura de host
-- precisaria descobrir publicamente. Nenhuma policy de INSERT/UPDATE/
-- DELETE é criada para anon nem para authenticated: como a RLS nega por
-- padrão qualquer comando sem uma policy que o autorize (mesmo padrão
-- documentado em rate_limit_counters, migration 20260817220099), as três
-- operações de escrita continuam bloqueadas para ambos os papéis mesmo
-- que o privilégio de tabela exista via
-- `alter default privileges ... to anon, authenticated`
-- (migration 20260817220067) — não há necessidade de um REVOKE
-- redundante à RLS para obter a mesma garantia.
--
-- `select` explícito para `anon` abaixo é só clareza documental: o
-- GRANT já existe via o mesmo default privilege da migration 220067;
-- reafirmá-lo aqui não concede nada a mais, só deixa a intenção
-- explícita no arquivo desta tabela (mesmo estilo da migration 220067).
grant select on public.tenant_domains to anon;

create policy "anon can view active tenant domains"
  on public.tenant_domains for select
  to anon
  using (status = 'active');
