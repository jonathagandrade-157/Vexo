-- Etapa 2 — proteção contra tenant hopping (arquitetura §25.1, item 11 do
-- prompt desta etapa).
--
-- Por que isto não pode ser só RLS: uma policy de UPDATE do tipo
-- `using (has_permission(tenant_id, 'x.update'))` autoriza a operação
-- olhando para o tenant_id da linha (OLD ou NEW, dependendo da cláusula),
-- mas não impede, por si só, que alguém com permissão em dois tenants
-- diferentes troque `tenant_id` de A para B numa única linha — a policy
-- pode aprovar o UPDATE achando que está validando "o tenant de destino",
-- sem perceber que também está validando (e permitindo) uma mudança de
-- tenant. Este trigger fecha essa lacuna no nível do banco,
-- independentemente de qualquer policy.
create function private.prevent_tenant_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception
      'tenant_id is immutable: cannot move a row from tenant % to tenant %',
      old.tenant_id, new.tenant_id
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

comment on function private.prevent_tenant_id_change() is
  'Anexar via "before update ... for each row execute function private.prevent_tenant_id_change()" em TODA tabela com tenant_id, presente e futura (arquitetura §25.1). Não precisa de SECURITY DEFINER: só compara colunas da própria linha, não acessa nenhuma outra tabela.';

create trigger prevent_tenant_id_change
  before update on public.tenant_members
  for each row
  execute function private.prevent_tenant_id_change();

-- audit_logs não recebe este trigger: ela já é 100% imutável após o
-- INSERT (0015 bloqueia todo UPDATE, não só o de tenant_id), o que é uma
-- proteção estritamente mais forte.
