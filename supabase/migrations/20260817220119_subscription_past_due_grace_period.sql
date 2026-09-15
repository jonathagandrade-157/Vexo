-- JON-17 — modelo de carência (grace period) para inadimplência.
--
-- 1) subscriptions.past_due_since: âncora de tempo do início da carência.
--    Nula enquanto a assinatura nunca falhou (ou já foi recuperada).
--    Escrita SOMENTE por apply_billing_webhook_event (PAYMENT_OVERDUE
--    fixa; PAYMENT_CONFIRMED limpa) — nunca por nenhuma leitura/UI.
--
-- 2) apply_billing_webhook_event: estende os dois branches já existentes
--    de PAYMENT_OVERDUE/PAYMENT_CONFIRMED (migration 20260817220074) para
--    também escrever em subscriptions.status/past_due_since. Mesma
--    assinatura, mesmo corpo, só os dois blocos abaixo mudam — nenhuma
--    outra branch (PAYMENT_CREATED/PAYMENT_RECEIVED/PAYMENT_REFUNDED/
--    SUBSCRIPTION_*/staleness/match exato de invoice) é alterada.
--
--    PAYMENT_OVERDUE: status vira 'past_due' sempre; past_due_since só é
--    setado na PRIMEIRA vez (coalesce nunca reseta o relógio se chegar
--    um segundo evento de cobrança falha antes da recuperação — decisão
--    explícita do ticket). Usa p_gateway_event_at (não now()), pela mesma
--    razão documentada no topo do arquivo original desta função: o
--    relógio da carência precisa refletir o momento real do evento no
--    gateway, nunca quando o VEXO processou/reprocessou o webhook —
--    um atraso de entrega ou um reprocessamento tardio não pode
--    desalinhar o início da carência do que realmente aconteceu.
--
--    PAYMENT_CONFIRMED: o UPDATE que já existia (status = 'active') passa
--    também a limpar past_due_since = null — reativação automática, sem
--    ação manual, no mesmo evento que já reativa a assinatura hoje.
--
-- 3) is_storefront_blocked(p_tenant_id): função pública nova, ANON-SAFE —
--    nunca reaproveita tenant_access_status() (exige is_tenant_member,
--    devolveria CANCELLED pra qualquer visitante anônimo — não serve
--    para gatear o storefront). Devolve só um boolean, nunca o motivo ou
--    a data — um visitante nunca aprende que a loja está inadimplente,
--    só que "está temporariamente indisponível" (a página que consome
--    isto decide a mensagem, não esta função). Mesmo padrão private/
--    public já usado por tenant_access_status (migration 20260817220055):
--    private.* faz o trabalho real (security definer, lê subscriptions,
--    que RLS nunca deixaria anon ler direto), public.* é só o wrapper
--    RPC-chamável (security invoker).
--
-- Bloqueio real do painel (dias 0-3 aviso, dia 4+ bloqueia edição) fica
-- nas Server Actions individuais, fora desta migration — elas leem
-- subscriptions.status/past_due_since via o client Supabase comum
-- (policy "tenant members and platform admins can select subscriptions",
-- migration 20260817220054, já permite), nenhuma função/coluna nova é
-- necessária para isso.

alter table public.subscriptions
  add column past_due_since timestamptz;

comment on column public.subscriptions.past_due_since is
  'JON-17 — momento em que apply_billing_webhook_event marcou esta assinatura past_due pela primeira vez desde a última recuperação. Null enquanto nunca falhou (ou já foi reativada). Nunca resetado por um segundo PAYMENT_OVERDUE antes de um PAYMENT_CONFIRMED — é o relógio da carência de 10 dias usado por is_storefront_blocked() (e, em TypeScript, pelo bloqueio de escrita do painel a partir do dia 4).';

create or replace function public.apply_billing_webhook_event(
  p_gateway text,
  p_event_type text,
  p_webhook_event_id uuid,
  p_gateway_event_at timestamptz,
  p_gateway_invoice_id text,
  p_gateway_subscription_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.billing_invoices;
  v_subscription public.subscriptions;
begin
  if p_gateway is null or p_event_type is null or p_webhook_event_id is null or p_gateway_event_at is null then
    raise exception 'apply_billing_webhook_event: missing required argument' using errcode = '22023';
  end if;
  if p_gateway not in ('asaas', 'stripe', 'iugu', 'pagarme', 'pagbank') then
    raise exception 'apply_billing_webhook_event: unsupported gateway %', p_gateway using errcode = '22023';
  end if;

  if p_event_type like 'SUBSCRIPTION_%' then
    return 'noop_subscription_event';
  end if;

  if p_event_type not in ('PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED') then
    return 'noop_unknown_event';
  end if;

  if p_event_type = 'PAYMENT_RECEIVED' then
    return 'noop_payment_received';
  end if;

  if p_gateway_invoice_id is null then
    raise exception 'apply_billing_webhook_event: % requires gateway_invoice_id, none provided', p_event_type
      using errcode = 'P0002';
  end if;

  select * into v_invoice
  from public.billing_invoices
  where gateway = p_gateway and gateway_invoice_id = p_gateway_invoice_id
  for update;

  if not found then
    raise exception 'apply_billing_webhook_event: no billing_invoices row for gateway=% gateway_invoice_id=%',
      p_gateway, p_gateway_invoice_id
      using errcode = 'P0002';
  end if;

  if v_invoice.last_gateway_event_at is not null and p_gateway_event_at <= v_invoice.last_gateway_event_at then
    return 'skipped_stale_event';
  end if;

  if p_event_type = 'PAYMENT_CREATED' then
    return 'noop_already_pending';
  end if;

  if p_event_type = 'PAYMENT_CONFIRMED' then
    if v_invoice.status <> 'PENDING' then
      return 'skipped_stale_event';
    end if;

    update public.billing_invoices
    set status = 'PAID',
        paid_at = p_gateway_event_at,
        confirmed_by_event_id = p_webhook_event_id,
        last_gateway_event_at = p_gateway_event_at
    where id = v_invoice.id;

    if p_gateway_subscription_id is not null then
      select * into v_subscription
      from public.subscriptions
      where gateway = p_gateway and gateway_subscription_id = p_gateway_subscription_id
      for update;

      if not found then
        raise exception 'apply_billing_webhook_event: PAYMENT_CONFIRMED but no subscriptions row for gateway=% gateway_subscription_id=%',
          p_gateway, p_gateway_subscription_id
          using errcode = 'P0002';
      end if;
      if v_subscription.id <> v_invoice.subscription_id then
        raise exception 'apply_billing_webhook_event: subscription/invoice mismatch (invoice.subscription_id=%, resolved subscription.id=%)',
          v_invoice.subscription_id, v_subscription.id
          using errcode = 'P0001';
      end if;
    else
      select * into v_subscription from public.subscriptions where id = v_invoice.subscription_id for update;
      if not found then
        raise exception 'apply_billing_webhook_event: invoice.subscription_id % has no subscriptions row', v_invoice.subscription_id
          using errcode = 'P0002';
      end if;
    end if;

    -- JON-17 — reativação automática: o mesmo UPDATE que já ativa a
    -- assinatura agora também limpa past_due_since, sem nenhuma ação
    -- manual. A condição `status <> 'active'` é a mesma de antes (evita
    -- um write redundante quando já está ativa) — se já está ativa,
    -- past_due_since já deveria estar null por este mesmo invariante.
    update public.subscriptions
    set status = 'active',
        current_period_start = v_invoice.period_start,
        current_period_end = v_invoice.period_end,
        past_due_since = null
    where id = v_subscription.id and status <> 'active';

    update public.trial_records
    set status = 'converted'
    where tenant_id = v_invoice.tenant_id and status = 'active';

    return 'payment_confirmed';
  end if;

  if p_event_type = 'PAYMENT_OVERDUE' then
    if v_invoice.status <> 'PENDING' then
      return 'skipped_stale_event';
    end if;
    update public.billing_invoices
    set status = 'FAILED',
        failed_at = p_gateway_event_at,
        failure_reason = 'asaas: payment overdue',
        last_gateway_event_at = p_gateway_event_at
    where id = v_invoice.id;

    -- JON-17 — inicia (ou mantém) a carência: past_due_since só é escrito
    -- na primeira vez (coalesce nunca reseta o relógio se um segundo
    -- PAYMENT_OVERDUE chegar antes de uma recuperação). Usa
    -- p_gateway_event_at (o momento real do evento no Asaas), nunca
    -- now() — mesma razão de last_gateway_event_at logo acima.
    update public.subscriptions
    set status = 'past_due',
        past_due_since = coalesce(past_due_since, p_gateway_event_at)
    where id = v_invoice.subscription_id;

    return 'payment_marked_failed';
  end if;

  if p_event_type = 'PAYMENT_REFUNDED' then
    if v_invoice.status <> 'PAID' then
      return 'skipped_stale_event';
    end if;
    update public.billing_invoices
    set status = 'REFUNDED',
        last_gateway_event_at = p_gateway_event_at
    where id = v_invoice.id;
    return 'payment_refunded';
  end if;

  return 'noop_unknown_event';
end;
$$;

comment on function public.apply_billing_webhook_event(text, text, uuid, timestamptz, text, text) is
  'Aplica um evento de webhook de BILLING já registrado em billing_webhook_events (idempotência resolvida ANTES desta chamada, via UNIQUE(provider, event_id)). PAYMENT_* exige match exato de (gateway, gateway_invoice_id) — nunca aproxima invoice, nunca cria uma que não existe. SUBSCRIPTION_* nunca altera subscriptions nesta etapa. PAYMENT_CONFIRMED ativa a assinatura, converte o trial e limpa past_due_since (JON-17). PAYMENT_OVERDUE marca past_due e inicia (sem resetar) a carência via past_due_since, usando o timestamp real do evento no gateway. Chamada só por service_role.';

-- private.is_storefront_blocked — lógica real, nunca chamável fora do
-- Postgres (é por isso que existe o wrapper public.* abaixo).
create function private.is_storefront_blocked(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions
    where tenant_id = p_tenant_id
      and status = 'past_due'
      and past_due_since is not null
      and now() >= past_due_since + interval '10 days'
  );
$$;

comment on function private.is_storefront_blocked(uuid) is
  'JON-17 — true só quando a assinatura está past_due há >= 10 dias (past_due_since). Deliberadamente NUNCA reaproveita tenant_access_status() (exige is_tenant_member/is_platform_admin, sempre devolveria CANCELLED para um visitante anônimo). Devolve só o boolean — nunca o motivo, nunca a data — quem consome isto (resolveStorefrontTenant) decide a mensagem exibida.';

-- Wrapper RPC-chamável (mesmo padrão de public.tenant_access_status,
-- migration 20260817220055) — security invoker: nada a proteger nesta
-- camada além do que private.is_storefront_blocked já protege sozinha.
create function public.is_storefront_blocked(p_tenant_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_storefront_blocked(p_tenant_id);
$$;

comment on function public.is_storefront_blocked(uuid) is
  'Wrapper RPC-chamável de private.is_storefront_blocked() — não duplica lógica. Chamável por anon: é o único ponto do sistema que expõe (só um boolean) status de billing para um visitante não autenticado, de propósito, para resolveStorefrontTenant() gatear a loja pública.';

revoke execute on function public.is_storefront_blocked(uuid) from public;
grant execute on function public.is_storefront_blocked(uuid) to anon, authenticated, service_role;
