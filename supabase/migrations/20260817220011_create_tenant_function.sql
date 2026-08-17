-- Etapa 2 — public.create_tenant() (arquitetura §25.1).
--
-- Único caminho autorizado para criar um tenant E se tornar seu primeiro
-- OWNER. Isso é o que fecha, na prática, a regra "nenhum usuário comum
-- pode se transformar em OWNER por conta própria" para o único caso em
-- que virar OWNER É legítimo (criar a própria loja): a atribuição de
-- OWNER não vem de um INSERT livre em tenant_members (que não tem policy
-- de INSERT para authenticated — ver 0013), vem exclusivamente daqui,
-- atomicamente com a criação do tenant.
--
-- SECURITY DEFINER é necessário porque a função insere em duas tabelas
-- (tenants, tenant_members) sem que o chamador tenha nenhuma policy de
-- INSERT nelas. Fica em `public` (não em `private`) porque é chamada
-- diretamente pela aplicação via RPC (`supabase.rpc('create_tenant', ...)`).
create function public.create_tenant(p_name text, p_slug text)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_owner_role_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'create_tenant: authentication required'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  select id into v_owner_role_id from public.roles where key = 'OWNER';
  if v_owner_role_id is null then
    -- Nunca deveria acontecer (seed em 0003) — falha alto e explícito em
    -- vez de criar um tenant sem OWNER.
    raise exception 'create_tenant: OWNER role is not seeded';
  end if;

  insert into public.tenants (name, slug, status, created_by)
  values (p_name, p_slug, 'pending', v_uid)
  returning * into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role_id, status)
  values (v_tenant.id, v_uid, v_owner_role_id, 'active');

  return v_tenant;
end;
$$;

comment on function public.create_tenant(text, text) is
  'Cria um tenant e atribui o usuário autenticado como OWNER, atomicamente. Único caminho legítimo para um usuário comum se tornar OWNER (arquitetura §25.1).';

revoke all on function public.create_tenant(text, text) from public;
grant execute on function public.create_tenant(text, text) to authenticated;
