-- Etapa 9 — RLS do carrinho, restrita a `anon` (nunca `authenticated` —
-- não há necessidade nesta etapa, e alargar seria repetir o erro já
-- corrigido na Etapa 6: RLS não distingue de onde a query vem, alargar
-- para `authenticated` alargaria para QUALQUER uso autenticado da
-- tabela, não só um cenário futuro de cliente logado).
--
-- Diferente de toda outra tabela do projeto (que usa RLS por
-- membership), aqui não existe identidade de sessão para checar "esse é
-- o SEU carrinho" — o visitante é anônimo. A policy garante só
-- INVARIANTES DE DADO (o tenant referenciado é um tenant publicado de
-- verdade), não posse por linha; a posse real do carrinho é garantida
-- pelo cookie httpOnly (`vexo_cart_{slug}`, não legível por JS/XSS) +
-- `cart_id` sendo um UUID de 122 bits (não adivinhável) — o mesmo
-- modelo de qualquer token de sessão/carrinho de e-commerce anônimo.
-- Isolamento entre tenants e entre produto/carrinho continua garantido
-- de verdade pelo trigger prevent_cross_tenant_cart_item (migration
-- anterior), que RLS sozinha não conseguiria expressar (comparação
-- entre tabelas).
create policy "anon can create a cart for a published tenant"
  on public.carts for insert
  to anon
  with check (
    exists (select 1 from public.tenants t where t.id = tenant_id and t.status not in ('suspended', 'deleted'))
  );

create policy "anon can read carts of published tenants"
  on public.carts for select
  to anon
  using (
    exists (select 1 from public.tenants t where t.id = carts.tenant_id and t.status not in ('suspended', 'deleted'))
  );

create policy "anon can add items to a published tenant's cart"
  on public.cart_items for insert
  to anon
  with check (
    exists (select 1 from public.tenants t where t.id = tenant_id and t.status not in ('suspended', 'deleted'))
  );

create policy "anon can read cart items of published tenants"
  on public.cart_items for select
  to anon
  using (
    exists (select 1 from public.tenants t where t.id = cart_items.tenant_id and t.status not in ('suspended', 'deleted'))
  );

create policy "anon can update cart items of published tenants"
  on public.cart_items for update
  to anon
  using (
    exists (select 1 from public.tenants t where t.id = cart_items.tenant_id and t.status not in ('suspended', 'deleted'))
  )
  with check (
    exists (select 1 from public.tenants t where t.id = tenant_id and t.status not in ('suspended', 'deleted'))
  );

create policy "anon can delete cart items of published tenants"
  on public.cart_items for delete
  to anon
  using (
    exists (select 1 from public.tenants t where t.id = cart_items.tenant_id and t.status not in ('suspended', 'deleted'))
  );

-- RLS restringe LINHAS, não concede privilégio de tabela — precisa do
-- GRANT explícito também (não presumir o privilégio default de `anon`
-- num projeto Supabase real; ver stub de teste, que já diferencia
-- `anon`=só SELECT por padrão vs `authenticated`=CRUD completo por
-- padrão). Só o que cada policy acima realmente permite: `carts` nunca
-- tem UPDATE/DELETE via `anon` nesta etapa, então não é concedido.
grant select, insert on public.carts to anon;
grant select, insert, update, delete on public.cart_items to anon;
