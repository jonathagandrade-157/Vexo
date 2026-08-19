-- Etapa 2 — funções auxiliares de autorização (arquitetura §6.1, §13 do
-- prompt desta etapa).
--
-- Todas SECURITY DEFINER, com duas razões (arquitetura §14):
--   1. Evitar recursão de RLS — se estas funções rodassem com os
--      privilégios de quem chama (`authenticated`), o SELECT que fazem em
--      tenant_members/platform_admins seria ele mesmo filtrado pelas
--      policies de RLS dessas tabelas, e essas policies chamam estas
--      mesmas funções para decidir o que mostrar → recursão.
--   2. Permitir a leitura mesmo sem uma policy de SELECT ampla nessas
--      tabelas para `authenticated` — a leitura fica inteiramente
--      encapsulada dentro da função, nunca exposta como uma query livre.
--
-- `set search_path = ''` + nomes 100% qualificados (public.tabela,
-- auth.uid()) em cada uma: elimina o risco de sequestro de search_path
-- (alguém criar um objeto de mesmo nome num schema anterior no search_path
-- para a função acabar lendo/chamando o objeto errado). Nenhuma destas
-- funções aceita SQL dinâmico, nome de tabela/coluna vindo de parâmetro,
-- nem qualquer outra entrada que pudesse virar um vetor de injeção.
create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

comment on function private.is_platform_admin() is
  'True se o usuário autenticado é MASTER ou SUPPORT_AGENT da plataforma.';

create function private.is_platform_support()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid() and pa.role = 'SUPPORT_AGENT'
  );
$$;

create function private.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  );
$$;

comment on function private.is_tenant_member(uuid) is
  'True se o usuário autenticado é membro ATIVO do tenant informado. Base de toda a estratégia de RLS multi-tenant (arquitetura §6, §12 do prompt desta etapa).';

create function private.has_role(p_tenant_id uuid, p_role_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    join public.roles r on r.id = tm.role_id
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and r.key = p_role_key
  );
$$;

create function private.is_tenant_owner(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(p_tenant_id, 'OWNER');
$$;

create function private.has_permission(p_tenant_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    join public.role_permissions rp on rp.role_id = tm.role_id
    join public.permissions p on p.id = rp.permission_id
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and p.key = p_permission_key
  );
$$;

comment on function private.has_permission(uuid, text) is
  'True se o usuário autenticado, através do seu papel no tenant informado, possui a permissão indicada (arquitetura §8).';

-- Nenhuma destas funções é chamada por "anon" nesta etapa (não há tabela
-- pública/storefront ainda) — EXECUTE concedido só a authenticated e
-- service_role, seguindo o princípio de menor privilégio.
grant execute on function private.is_platform_admin() to authenticated, service_role;
grant execute on function private.is_platform_support() to authenticated, service_role;
grant execute on function private.is_tenant_member(uuid) to authenticated, service_role;
grant execute on function private.has_role(uuid, text) to authenticated, service_role;
grant execute on function private.is_tenant_owner(uuid) to authenticated, service_role;
grant execute on function private.has_permission(uuid, text) to authenticated, service_role;

-- Agora que private.is_platform_admin() existe, completa a RLS de
-- profiles (0002) com a visibilidade do MASTER — necessária para telas
-- futuras de gestão de contas, mas já correta e testável desde já.
create policy "platform admins can select all profiles"
  on public.profiles for select
  to authenticated
  using (private.is_platform_admin());
