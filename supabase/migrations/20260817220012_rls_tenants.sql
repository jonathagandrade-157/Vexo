-- Etapa 2 — RLS de tenants (arquitetura §6, §25.1).
create policy "tenant members and platform admins can select tenants"
  on public.tenants for select
  to authenticated
  using (private.is_tenant_member(id) or private.is_platform_admin());

create policy "tenant staff with settings.update can update their tenant"
  on public.tenants for update
  to authenticated
  using (private.has_permission(id, 'settings.update') or private.is_platform_admin())
  with check (private.has_permission(id, 'settings.update') or private.is_platform_admin());

-- Sem policy de INSERT/DELETE para authenticated: criação só via
-- public.create_tenant() (0011); não há exclusão física nesta etapa —
-- fechamento de loja é modelado como status = 'deleted' (um UPDATE),
-- coberto pela policy acima + pelo trigger abaixo.

-- has_permission('settings.update') sozinho permitiria que um OWNER/ADMIN
-- mudasse tenants.status por conta própria (ex.: se auto-reativar depois
-- de suspenso pelo MASTER) — RLS não faz checagem coluna-a-coluna. Este
-- trigger fecha essa lacuna: só platform admin pode mudar `status`,
-- independentemente de quem tem settings.update.
create function private.prevent_unauthorized_tenant_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and not private.is_platform_admin() then
    raise exception
      'tenants.status can only be changed by a platform admin'
      using errcode = '42501'; -- insufficient_privilege
  end if;
  return new;
end;
$$;

comment on function private.prevent_unauthorized_tenant_status_change() is
  'Sem SECURITY DEFINER: só chama private.is_platform_admin(), que já resolve seu próprio contexto de segurança — não há necessidade de elevar privilégio aqui (arquitetura §14: minimizar uso de DEFINER).';

create trigger prevent_unauthorized_tenant_status_change
  before update on public.tenants
  for each row
  execute function private.prevent_unauthorized_tenant_status_change();
