-- Etapa 2 — RLS + privilégios de platform_admins (arquitetura §9, §25.1;
-- item 9 do prompt desta etapa: "usuário comum NÃO pode inserir, atualizar,
-- remover, promover... a gestão deve ocorrer fora do fluxo normal do
-- frontend/aplicação").
--
-- Só quem já é platform admin pode ver a lista (evita revelar quem é
-- MASTER a qualquer usuário autenticado).
create policy "platform admins can select platform_admins"
  on public.platform_admins for select
  to authenticated
  using (private.is_platform_admin());

-- Nenhuma policy de INSERT/UPDATE/DELETE é criada para nenhum papel —
-- RLS nega por padrão na ausência de policy. Isso por si só já bloquearia
-- authenticated/anon, mas não bloquearia service_role (BYPASSRLS). Por
-- isso, abaixo, os privilégios de escrita são revogados da tabela
-- inteira, inclusive de service_role: gestão de platform_admins não deve
-- ser alcançável nem por código server-side da aplicação, só por conexão
-- direta ao banco (Supabase Studio / CLI administrativo), exatamente como
-- pedido — "fora do fluxo normal do frontend/aplicação".
revoke insert, update, delete on public.platform_admins from anon, authenticated, service_role;
