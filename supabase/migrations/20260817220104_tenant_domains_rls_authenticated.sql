-- D18.2 — fecha o gap MÉDIO da auditoria D18.0 (§F): `tenant_domains` tem
-- RLS habilitada e forçada desde D17.1 (20260817220100), mas só tinha uma
-- policy pública de SELECT para `anon` (`status = 'active'`) — nenhuma
-- policy para `authenticated`. Na ausência de policy, RLS nega por padrão
-- (mesmo padrão já documentado em 220100/rate_limit_counters/220099), então
-- hoje QUALQUER acesso autenticado a esta tabela só é possível via
-- `service_role` (bypassa RLS por completo) — as Server Actions de domínio
-- usam `createSupabaseServiceRoleClient()` só por esse motivo (comentários
-- em features/settings/domain-actions.ts/domain-verification-actions.ts/
-- domain-vercel-actions.ts), nunca para contornar autorização de negócio.
--
-- Esta migration é EXCLUSIVAMENTE aditiva: 4 novas policies para
-- `authenticated` (SELECT/INSERT/UPDATE/DELETE, cada uma escopada por
-- tenant via private.is_tenant_member()/private.has_permission()). Nenhuma
-- coluna, constraint, índice, trigger, a policy `anon` existente,
-- private.log_audit(), o RBAC ou a migration D18.1 são alterados.
--
-- Nenhuma das funções usadas aqui é nova: private.is_tenant_member(uuid) e
-- private.has_permission(uuid, text) já existem desde a Etapa 2
-- (20260817220009), SECURITY DEFINER, sempre derivando a identidade de
-- auth.uid() internamente — nunca aceitam um "usuário" como argumento, e
-- nunca confiam no tenant_id em si isoladamente: `has_permission(tenant_id,
-- 'x')`/`is_tenant_member(tenant_id)` só retornam true quando EXISTE uma
-- linha ativa em tenant_members para (auth.uid(), tenant_id) — ou seja, é a
-- combinação (usuário da sessão + tenant reivindicado) que precisa bater
-- com uma associação real, nunca o tenant_id sozinho como fonte de
-- autorização (regra fundamental do ticket D18.2).

-- ============================================================
-- SELECT — qualquer membro ATIVO do tenant (mesmo padrão de visibilidade
-- já usado pela própria Server Action: app/painel/configuracoes/dominio/
-- page.tsx chama listTenantDomains() para qualquer membership, gatendo só
-- a edição do formulário por settings.update, nunca a visualização).
--
-- Deliberadamente SEM "or private.is_platform_admin()" — diferente do
-- padrão geral já usado em tenants/categories/products (Etapa 2/7): não
-- existe hoje nenhuma tela do Master Panel para gestão de domínio, e
-- conceder a leitura ao platform_admin aqui seria uma superfície de acesso
-- nova sem nenhum consumidor real por trás (ticket D18.2, regra explícita
-- "platform_admin não recebe acesso implícito a tenant_domains apenas por
-- ser platform_admin"). Se uma tela Master de domínios for aprovada no
-- futuro, essa policy é o lugar certo para adicionar o acesso, numa
-- migration própria e justificada por aquela feature.
-- ============================================================
create policy "tenant members can select their tenant domains"
  on public.tenant_domains for select
  to authenticated
  using (private.is_tenant_member(tenant_id));

-- ============================================================
-- INSERT/UPDATE/DELETE — coerente com a autorização que já vale no
-- servidor: toda Server Action de domínio (domain-actions.ts,
-- domain-verification-actions.ts, domain-vercel-actions.ts) já exige
-- `settings.update` antes de qualquer escrita (resolveTenantAndPermission()).
-- RLS aqui é uma SEGUNDA camada, independente da checagem em TypeScript —
-- exatamente o gap estrutural apontado pela auditoria D18.0 (§F, risco
-- MÉDIO): hoje um bug futuro numa Server Action de domínio não seria pego
-- por nada além do próprio código; com esta migration, mesmo que uma
-- checagem em TypeScript seja esquecida amanhã, o banco recusa a escrita.
--
-- has_permission(tenant_id, 'settings.update') já exige uma linha ATIVA em
-- tenant_members (mesmo raciocínio documentado em 220026 para
-- categories/products) — não é necessário combinar com is_tenant_member
-- separadamente.
-- ============================================================
create policy "tenant staff with settings.update can insert tenant domains"
  on public.tenant_domains for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'settings.update'));

create policy "tenant staff with settings.update can update tenant domains"
  on public.tenant_domains for update
  to authenticated
  using (private.has_permission(tenant_id, 'settings.update'))
  with check (private.has_permission(tenant_id, 'settings.update'));

create policy "tenant staff with settings.update can delete tenant domains"
  on public.tenant_domains for delete
  to authenticated
  using (private.has_permission(tenant_id, 'settings.update'));

-- ============================================================
-- Policy anon existente (220100) e FORCE ROW LEVEL SECURITY: sem alteração
-- nenhuma — reafirmados aqui só como documentação, não uma nova instrução
-- SQL (nenhum DROP/ALTER abaixo, só comentário):
--
--   alter table public.tenant_domains enable row level security;  -- já ativo
--   alter table public.tenant_domains force row level security;   -- já ativo, mantido
--   create policy "anon can view active tenant domains" ...        -- já existe, intocada
--
-- `anon` continua sem NENHUMA policy de INSERT/UPDATE/DELETE (nunca
-- concedida, nem antes nem depois desta migration) — RLS nega por padrão,
-- então escrita por `anon` permanece impossível.
-- ============================================================
