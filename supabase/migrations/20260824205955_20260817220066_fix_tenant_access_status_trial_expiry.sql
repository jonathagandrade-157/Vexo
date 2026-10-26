-- Etapa 16 — corrige uma regressão introduzida pela própria Etapa 16
-- (migration 20260817220063, `link_trial_to_subscription`): antes dela,
-- nenhum tenant em trial tinha uma `subscriptions` row, então
-- `tenant_access_status()` (20260817220055) sempre caía para
-- `trial_records`, cuja checagem `ends_at > now()` fazia o trial expirar
-- de verdade. Agora que todo trial ganha uma `subscriptions` row
-- (status 'trialing') no INSERT em `trial_records`, o `if v_sub.id is not
-- null` passa a ser sempre verdadeiro, e o branch original
-- `when 'trialing' then 'TRIALING'` não olhava nenhuma data — resultado:
-- trial NUNCA mais expirava (achado ao rodar
-- commercial-foundation.test.ts: "tenant_access_status falls back to
-- trial_records when no subscription exists" passou a falhar, esperando
-- EXPIRED e recebendo TRIALING).
--
-- Correção: quando a subscription está em 'trialing', consulta
-- `trial_records` diretamente (a mesma fonte que o branch de fallback já
-- lia) em vez de confiar em `subscriptions.trial_end` — esse campo é só
-- um espelho escrito uma única vez, no INSERT de trial_records
-- (20260817220063); se as datas do trial forem alteradas depois (ex.:
-- MASTER estende um trial atualizando trial_records), o espelho fica
-- desatualizado. `trial_records` continua sendo a ÚNICA fonte de verdade
-- das datas, exatamente como documentado — esta correção só faz a
-- função realmente se comportar assim quando existe uma subscription
-- 'trialing' (o caso normal agora, depois de 20260817220063), não só
-- quando não existe nenhuma. Só cai de volta em
-- `subscriptions.trial_end` no caso raro de uma subscription 'trialing'
-- sem nenhum trial_records associado (ex.: atribuída manualmente pelo
-- MASTER, fora do fluxo de trial da Etapa 3). Nenhuma outra branch da
-- função (tenants.status, active/past_due/suspended/cancelled, fallback
-- puro para trial_records quando não há subscription) muda.
create or replace function private.tenant_access_status(p_tenant_id uuid)
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

  select * into v_trial from public.trial_records where tenant_id = p_tenant_id;

  select * into v_sub from public.subscriptions where tenant_id = p_tenant_id;
  if v_sub.id is not null then
    if v_sub.status = 'trialing' then
      if v_trial.id is not null then
        if v_trial.status = 'converted' then
          return 'ACTIVE';
        end if;
        if v_trial.status = 'active' and v_trial.ends_at > now() then
          return 'TRIALING';
        end if;
        return 'EXPIRED';
      end if;
      -- Subscription 'trialing' sem nenhum trial_records associado
      -- (fora do fluxo normal da Etapa 3/16) — usa o espelho em
      -- subscriptions.trial_end, se houver; sem nenhuma data, mantém o
      -- status declarado pela própria subscription.
      if v_sub.trial_end is not null and v_sub.trial_end <= now() then
        return 'EXPIRED';
      end if;
      return 'TRIALING';
    end if;

    return case v_sub.status
      when 'active' then 'ACTIVE'
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
  'Status de acesso comercial do tenant (ACTIVE/TRIALING/EXPIRED/SUSPENDED/CANCELLED) — ordem: tenants.status, depois subscriptions (trialing checa trial_records.ends_at, ou trial_end como fallback sem trial_records), depois trial_records puro (Etapa 3, preservada). Fonte única, nunca duplicada em página nenhuma.';
