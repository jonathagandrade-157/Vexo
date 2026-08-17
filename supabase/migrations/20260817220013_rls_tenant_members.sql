-- Etapa 2 — RLS de tenant_members (arquitetura §6, §25.1; itens 6 e 13 do
-- prompt desta etapa: a regra de OWNER "deve ser protegida tanto por RLS
-- quanto por mecanismos adicionais necessários — não confiar somente no
-- frontend [nem somente na policy]").
create policy "tenant members and platform admins can select tenant_members"
  on public.tenant_members for select
  to authenticated
  using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

-- Sem policy de INSERT para authenticated: a única linha criada "pelo
-- próprio usuário" é a de OWNER dentro de public.create_tenant() (0011,
-- SECURITY DEFINER); convite de novos membros é uma função server-side
-- controlada de uma etapa futura, não um INSERT livre do client.
create policy "team managers can update other members roles"
  on public.tenant_members for update
  to authenticated
  using (
    private.is_platform_admin()
    or (private.has_permission(tenant_id, 'team.manage') and user_id <> auth.uid())
  )
  with check (
    private.is_platform_admin()
    or (private.has_permission(tenant_id, 'team.manage') and user_id <> auth.uid())
  );

create policy "team managers can remove other members"
  on public.tenant_members for delete
  to authenticated
  using (
    private.is_platform_admin()
    or (
      private.has_permission(tenant_id, 'team.manage')
      and user_id <> auth.uid()
      -- Remover alguém com papel OWNER só pode ser feito por outro OWNER
      -- (ou platform admin) — um ADMIN com team.manage não pode expulsar
      -- o dono da loja.
      and (
        not exists (
          select 1 from public.roles r
          where r.id = tenant_members.role_id and r.key = 'OWNER'
        )
        or private.is_tenant_owner(tenant_id)
      )
    )
  );

-- Mecanismos adicionais (defesa em profundidade, independentes da RLS
-- acima — cobrem inclusive o cenário em que uma policy futura for editada
-- incorretamente e ainda assim tentar permitir o que estes triggers
-- proíbem incondicionalmente):

-- 1) Identidade da linha é imutável: uma associação, uma vez criada,
--    sempre se refere ao mesmo usuário. Trocar o "dono" de uma linha
--    existente poderia ser usado para contornar a ausência de policy de
--    INSERT (reaproveitando uma linha em vez de criar uma nova).
create function private.prevent_tenant_member_user_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception
      'tenant_members.user_id is immutable — remove and re-invite instead'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

create trigger prevent_tenant_member_user_id_change
  before update on public.tenant_members
  for each row
  execute function private.prevent_tenant_member_user_id_change();

-- 2) Ninguém altera o próprio papel, nem mesmo alguém com team.manage —
--    fecha o caso "ADMIN com team.manage se autopromove a OWNER", que uma
--    policy baseada só em has_permission(tenant_id, 'team.manage') não
--    detectaria sozinha.
create function private.prevent_self_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role_id is distinct from old.role_id
     and new.user_id = auth.uid()
     and auth.role() is distinct from 'service_role'
  then
    raise exception 'a member cannot change their own role'
      using errcode = '42501'; -- insufficient_privilege
  end if;
  return new;
end;
$$;

create trigger prevent_self_role_change
  before update on public.tenant_members
  for each row
  execute function private.prevent_self_role_change();

-- 3) Só um OWNER (ou platform admin) pode conceder o papel OWNER a
--    alguém — nunca um ADMIN/MANAGER, mesmo que tenha team.manage.
create function private.prevent_unauthorized_owner_grant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new_role_key text;
begin
  if new.role_id is distinct from old.role_id then
    select key into v_new_role_key from public.roles where id = new.role_id;
    if v_new_role_key = 'OWNER'
       and not private.is_tenant_owner(new.tenant_id)
       and not private.is_platform_admin()
    then
      raise exception
        'only an existing OWNER (or a platform admin) can grant the OWNER role'
        using errcode = '42501'; -- insufficient_privilege
    end if;
  end if;
  return new;
end;
$$;

create trigger prevent_unauthorized_owner_grant
  before update on public.tenant_members
  for each row
  execute function private.prevent_unauthorized_owner_grant();
