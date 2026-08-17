-- Etapa 2 — RLS + imutabilidade de audit_logs (arquitetura §18.2, §25.1;
-- itens 8, 10 e 20 (testes 8/9) do prompt desta etapa).
create policy "tenant members and platform admins can select audit_logs"
  on public.audit_logs for select
  to authenticated
  using (
    (tenant_id is not null and private.is_tenant_member(tenant_id))
    or private.is_platform_admin()
  );

-- Sem policy de INSERT: a única escrita permitida é através de
-- private.log_audit() (0010), que roda como o dono da função (postgres),
-- imune a este REVOKE.
--
-- O REVOKE abaixo é a garantia real de que ninguém edita/apaga um log —
-- inclusive service_role, que tem BYPASSRLS e portanto NÃO seria contido
-- por nenhuma policy de RLS, por mais restritiva que fosse. GRANT/REVOKE é
-- uma camada de controle de acesso separada de RLS, e essa é a única que
-- realmente restringe um papel com BYPASSRLS.
revoke insert, update, delete on public.audit_logs from anon, authenticated, service_role;

-- Segunda camada, redundante de propósito: mesmo que um papel readquirisse
-- UPDATE/DELETE por engano (ex.: um GRANT ALL futuro mal revisado), este
-- trigger ainda rejeita incondicionalmente. Não usa SECURITY DEFINER — não
-- precisa: só recusa a operação, não acessa nenhum outro objeto.
create function private.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only: % is not allowed', tg_op
    using errcode = '42501'; -- insufficient_privilege
end;
$$;

create trigger prevent_audit_log_mutation
  before update or delete on public.audit_logs
  for each row
  execute function private.prevent_audit_log_mutation();
