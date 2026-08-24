-- Etapa 16 — corrige uma lacuna real da fundação comercial (Etapa 14):
-- `subscriptions` nunca era criada automaticamente ("Não é uma linha
-- criada automaticamente por create_tenant()" — comentário original da
-- migration 20260817220054). Isso era proposital para `tenant_access_status()`
-- (que cai para `trial_records` sem problema), mas `tenant_has_feature()` e
-- `tenant_plan_limit()` (mesma migration 20260817220055/59) exigem uma
-- `subscriptions.plan_id` para responder qualquer coisa — sem isso, TODO
-- tenant em trial (a esmagadora maioria hoje, já que cobrança real não
-- existe) tem `tenant_has_feature` sempre `false` e `tenant_plan_limit`
-- sempre `NULL`, para qualquer recurso/limite. Enforcement real de plano
-- (prompt Etapa 16) é impossível sem consertar isso primeiro.
--
-- Correção aditiva, não uma reescrita da Etapa 3: `trial_records` continua
-- a ÚNICA fonte de datas de trial (started_at/ends_at/status) — este
-- trigger só cria o VÍNCULO comercial (tenant → plano BASIC) que faltava,
-- espelhando started_at/ends_at nas colunas `subscriptions.trial_start`/
-- `trial_end` que a Etapa 14 (ajuste arquitetural) já deixou preparadas
-- exatamente para isto ("existem para uma etapa futura... colunas ainda
-- não escritas por nenhum código" — agora escritas, só como espelho
-- informativo, nunca como fonte de verdade: `tenant_access_status()`
-- continua lendo de `trial_records`, não fica tocado por este arquivo).
--
-- Plano padrão: BASIC — todo novo cadastro começa no piso, MASTER pode
-- reatribuir manualmente a qualquer momento (RLS de subscriptions,
-- inalterada, continua exigindo `is_platform_master()` para UPDATE).
create function private.link_trial_to_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basic_plan_id uuid;
begin
  select id into v_basic_plan_id from public.plans where slug = 'basic';
  if v_basic_plan_id is null then
    -- Sem seed de planos (ambiente incompleto) — não bloqueia o trial em
    -- si (arquitetura §13 preservada), só não cria o vínculo comercial.
    return new;
  end if;

  insert into public.subscriptions (tenant_id, plan_id, status, trial_start, trial_end)
  values (new.tenant_id, v_basic_plan_id, 'trialing', new.started_at, new.ends_at)
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

comment on function private.link_trial_to_subscription() is
  'Etapa 16 — cria a subscriptions row (plano BASIC, status trialing) que faltava desde a Etapa 14, para que tenant_has_feature/tenant_plan_limit tenham uma resposta real. trial_records continua a única fonte de datas de trial.';

create trigger link_trial_to_subscription
  after insert on public.trial_records
  for each row execute function private.link_trial_to_subscription();

-- Backfill: tenants que já iniciaram trial antes desta migration e ainda
-- não têm subscription (o caso comum até agora, já que nada criava uma).
insert into public.subscriptions (tenant_id, plan_id, status, trial_start, trial_end)
select tr.tenant_id, p.id, 'trialing', tr.started_at, tr.ends_at
from public.trial_records tr
cross join lateral (select id from public.plans where slug = 'basic') p
where not exists (select 1 from public.subscriptions s where s.tenant_id = tr.tenant_id);
