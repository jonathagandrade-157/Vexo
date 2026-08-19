-- Etapa 14 — as duas funções centrais da fundação comercial (prompt
-- §11/§12): ponto único de autorização por assinatura/recurso, nunca
-- duplicado em página nenhuma (prompt §2: nada de `if (plan === "PRO")`
-- espalhado). SECURITY DEFINER (mesmo motivo de sempre desde a Etapa 2 —
-- ler subscriptions/trial_records/plans/plan_features sem depender das
-- policies de RLS dessas tabelas, e sem expor uma query livre nelas).
--
-- private.tenant_access_status(): ordem de precedência (prompt §11.4):
-- 1) tenants.status (suspenso/excluído sempre vence, é o mecanismo de
--    bloqueio já usado por toda RLS pública desde a Etapa 6);
-- 2) subscriptions, se existir;
-- 3) trial_records, se não houver subscription ainda — preserva
--    integralmente o mecanismo da Etapa 3 (prompt §10: "preservar
--    completamente"), sem duplicar started_at/ends_at/status em lugar
--    nenhum novo.
create function private.tenant_access_status(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_sub public.subscriptions;
  v_trial public.trial_records;
begin
  -- Achado da revisão de segurança: sem esta guarda (a mesma que
  -- tenant_has_feature já tinha desde o início), qualquer usuário
  -- autenticado podia consultar o status comercial de QUALQUER tenant —
  -- inclusive concorrentes — só sabendo o uuid. `authenticated` é
  -- grantado nesta função (linha ~149) porque o dono da própria loja
  -- precisa consultá-la; nunca foi para liberar qualquer tenant.
  if not (private.is_tenant_member(p_tenant_id) or private.is_platform_admin()) then
    return 'CANCELLED';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if v_tenant.id is null then
    return 'CANCELLED';
  end if;

  if v_tenant.status in ('suspended', 'deleted') then
    return 'SUSPENDED';
  end if;

  select * into v_sub from public.subscriptions where tenant_id = p_tenant_id;
  if v_sub.id is not null then
    return case v_sub.status
      when 'active' then 'ACTIVE'
      when 'trialing' then 'TRIALING'
      -- past_due: cobrança pendente, mas ainda não bloqueado
      -- automaticamente (prompt §9/§30: "não implementar cobrança/
      -- bloqueio automático" nesta etapa) — tratado como ACTIVE até uma
      -- etapa futura decidir a política de carência.
      when 'past_due' then 'ACTIVE'
      when 'suspended' then 'SUSPENDED'
      else 'CANCELLED' -- cancelled, expired
    end;
  end if;

  -- Sem subscription ainda: cai para trial_records (Etapa 3, intocada).
  select * into v_trial from public.trial_records where tenant_id = p_tenant_id;
  if v_trial.id is not null then
    if v_trial.status = 'converted' then
      return 'ACTIVE';
    end if;
    if v_trial.status = 'active' and v_trial.ends_at > now() then
      return 'TRIALING';
    end if;
    return 'EXPIRED';
  end if;

  -- Nem subscription nem trial_records: nenhuma relação comercial
  -- conhecida — resposta conservadora (fail-closed), nunca presume
  -- acesso que nunca foi concedido.
  return 'EXPIRED';
end;
$$;

comment on function private.tenant_access_status(uuid) is
  'Status de acesso comercial do tenant (ACTIVE/TRIALING/EXPIRED/SUSPENDED/CANCELLED) — ordem: tenants.status, depois subscriptions, depois trial_records (Etapa 3, preservada). Fonte única, nunca duplicada em página nenhuma.';

-- private.tenant_has_feature(): fecha em `false` (prompt §13: "nunca
-- confiar somente no frontend" — o backend É a validação definitiva) em
-- QUALQUER caso ambíguo: chamador sem relação com o tenant, tenant sem
-- acesso ativo, tenant sem plano atribuído, ou recurso desativado
-- globalmente pelo MASTER.
create function private.tenant_has_feature(p_tenant_id uuid, p_feature_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_plan_id uuid;
begin
  if not (private.is_tenant_member(p_tenant_id) or private.is_platform_admin()) then
    return false;
  end if;

  v_status := private.tenant_access_status(p_tenant_id);
  if v_status not in ('ACTIVE', 'TRIALING') then
    return false;
  end if;

  select plan_id into v_plan_id from public.subscriptions where tenant_id = p_tenant_id;
  if v_plan_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.plan_features pf
    join public.features f on f.id = pf.feature_id
    where pf.plan_id = v_plan_id and f.key = p_feature_key and f.is_active
  );
end;
$$;

comment on function private.tenant_has_feature(uuid, text) is
  'Fonte oficial de feature gating (prompt §12) — considera membership, status de acesso e associação plano→recurso. Fecha em false para qualquer caso ambíguo, nunca assume acesso.';

grant execute on function private.tenant_access_status(uuid) to authenticated, service_role;
grant execute on function private.tenant_has_feature(uuid, text) to authenticated, service_role;

-- Wrappers RPC-chamáveis (mesmo padrão de public.has_permission, Etapa
-- 5) — Server Actions/Components fora do Postgres só alcançam funções em
-- `public`. `security invoker`: nada a proteger nesta camada além do que
-- as funções `private.*` já protegem sozinhas.
create function public.tenant_access_status(p_tenant_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select private.tenant_access_status(p_tenant_id);
$$;

create function public.tenant_has_feature(p_tenant_id uuid, p_feature_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.tenant_has_feature(p_tenant_id, p_feature_key);
$$;

comment on function public.tenant_access_status(uuid) is
  'Wrapper RPC-chamável de private.tenant_access_status() — não duplica lógica.';
comment on function public.tenant_has_feature(uuid, text) is
  'Wrapper RPC-chamável de private.tenant_has_feature() — fonte oficial de feature gating para Server Actions/Components (prompt §12).';

revoke execute on function public.tenant_access_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.tenant_access_status(uuid) to authenticated, service_role;

revoke execute on function public.tenant_has_feature(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.tenant_has_feature(uuid, text) to authenticated, service_role;
