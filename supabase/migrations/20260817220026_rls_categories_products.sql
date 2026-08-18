-- Etapa 7 — RLS de categories/products (prompt Etapa 7 §8/§10).
--
-- Policies de escrita usam só has_permission(tenant_id, '<recurso>.<ação>')
-- — não precisam também checar is_tenant_member: has_permission já exige
-- uma linha ativa em tenant_members para ser true (Etapa 2), então "tem a
-- permissão" já implica "é membro". SELECT administrativo gated por
-- '<recurso>.view' especificamente (não is_tenant_member sozinho) porque
-- a matriz de papéis desta etapa dá `view` só a OWNER/ADMIN/MANAGER —
-- OPERATOR/SUPPORT são membros do tenant mas não devem ver o catálogo no
-- painel administrativo.
create policy "tenant staff with categories.view can select categories"
  on public.categories for select
  to authenticated
  using (private.has_permission(tenant_id, 'categories.view') or private.is_platform_admin());

create policy "tenant staff with categories.create can insert categories"
  on public.categories for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'categories.create'));

create policy "tenant staff with categories.update can update categories"
  on public.categories for update
  to authenticated
  using (private.has_permission(tenant_id, 'categories.update'))
  with check (private.has_permission(tenant_id, 'categories.update'));

create policy "tenant staff with categories.delete can delete categories"
  on public.categories for delete
  to authenticated
  using (private.has_permission(tenant_id, 'categories.delete'));

create policy "tenant staff with products.view can select products"
  on public.products for select
  to authenticated
  using (private.has_permission(tenant_id, 'products.view') or private.is_platform_admin());

create policy "tenant staff with products.create can insert products"
  on public.products for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'products.create'));

create policy "tenant staff with products.update can update products"
  on public.products for update
  to authenticated
  using (private.has_permission(tenant_id, 'products.update'))
  with check (private.has_permission(tenant_id, 'products.update'));

create policy "tenant staff with products.delete can delete products"
  on public.products for delete
  to authenticated
  using (private.has_permission(tenant_id, 'products.delete'));

-- Leitura pública (storefront) — só `anon`, nunca `authenticated` (a
-- Etapa 6 corrigiu exatamente esse erro para `tenants`: cobrir
-- `authenticated` alargaria a visibilidade para QUALQUER uso autenticado
-- da tabela, não só o storefront, porque RLS não distingue de onde a
-- query está vindo). O storefront usa createSupabasePublicClient()
-- (Etapa 6), que nunca carrega sessão — autentica como `anon` mesmo com
-- o visitante logado em outra aba, então `anon` sozinho já é suficiente.
--
-- Menor privilégio: só linhas com status ativo, de um tenant que também
-- não está suspenso/excluído — os dois filtros são necessários (um
-- produto pode estar 'active' num tenant que foi suspenso depois).
create policy "anyone can view active products of publicly visible tenants"
  on public.products for select
  to anon
  using (
    status = 'active'
    and exists (
      select 1 from public.tenants t
      where t.id = products.tenant_id and t.status not in ('suspended', 'deleted')
    )
  );

create policy "anyone can view active categories of publicly visible tenants"
  on public.categories for select
  to anon
  using (
    status = 'active'
    and exists (
      select 1 from public.tenants t
      where t.id = categories.tenant_id and t.status not in ('suspended', 'deleted')
    )
  );
