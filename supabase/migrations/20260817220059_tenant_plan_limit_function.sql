-- Etapa 14 (ajuste arquitetural) — private.tenant_plan_limit(): leitura
-- do limite numérico do plano atual do tenant para uma chave. Mesmo
-- guard de autorização de tenant_has_feature (achado da revisão de
-- segurança já aplicado a tenant_access_status): fecha em NULL para
-- qualquer chamador sem relação com o tenant, nunca vaza limite de
-- outro tenant. NULL também é o retorno quando o plano não tem aquele
-- limite configurado — "sem limite definido" é deliberadamente distinto
-- de "-1 (ilimitado)": o chamador decide o que fazer com "não
-- configurado" (ex.: aplicar um teto padrão) em vez do banco decidir
-- por ele.
--
-- Só a LEITURA é exposta aqui — a tabela em si continua MASTER-only
-- (RLS, migration anterior); esta função só permite que o próprio
-- tenant consulte o número do seu plano sem precisar de acesso direto à
-- tabela (mesmo padrão de tenant_has_feature consultando plan_features
-- sem dar acesso direto a ela).
create function private.tenant_plan_limit(p_tenant_id uuid, p_limit_key text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_value integer;
begin
  if not (private.is_tenant_member(p_tenant_id) or private.is_platform_admin()) then
    return null;
  end if;

  select plan_id into v_plan_id from public.subscriptions where tenant_id = p_tenant_id;
  if v_plan_id is null then
    return null;
  end if;

  select limit_value into v_value
  from public.plan_limits
  where plan_id = v_plan_id and limit_key = p_limit_key;

  return v_value;
end;
$$;

comment on function private.tenant_plan_limit(uuid, text) is
  'Lê o limite numérico (ex.: products_limit) do plano atual do tenant. NULL = sem relação/sem subscription/limite não configurado; -1 = ilimitado (nunca confundir os dois).';

grant execute on function private.tenant_plan_limit(uuid, text) to authenticated, service_role;

create function public.tenant_plan_limit(p_tenant_id uuid, p_limit_key text)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select private.tenant_plan_limit(p_tenant_id, p_limit_key);
$$;

comment on function public.tenant_plan_limit(uuid, text) is
  'Wrapper RPC-chamável de private.tenant_plan_limit() — leitura de limite numérico do plano do tenant.';

revoke execute on function public.tenant_plan_limit(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.tenant_plan_limit(uuid, text) to authenticated, service_role;
