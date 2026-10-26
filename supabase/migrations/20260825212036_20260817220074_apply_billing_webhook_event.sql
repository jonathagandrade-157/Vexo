-- Etapa 20.2.7.1 — public.apply_billing_webhook_event(): aplica um evento
-- de webhook do gateway de BILLING (VEXO cobrando o lojista) já registrado
-- em billing_webhook_events (idempotência por UNIQUE(provider, event_id),
-- migration 20260817220071 — resolvida ANTES desta função, pelo Route
-- Handler, que insere ali com `on conflict do nothing` e só chama esta
-- função quando a linha é realmente nova). Esta função nunca insere/
-- atualiza billing_webhook_events: recebe só o `id` (uuid) da linha já
-- gravada, para poder referenciá-la em billing_invoices.confirmed_by_event_id
-- (FK real — nunca o event_id texto do gateway).
--
-- PAYMENT_* exige match EXATO de (gateway, gateway_invoice_id) contra
-- billing_invoices — nunca aproxima pela invoice PENDING mais recente, e
-- nunca cria uma invoice que não exista. Sem match exato: exceção
-- controlada (P0002), nunca um "melhor palpite".
--
-- SUBSCRIPTION_* nunca faz lookup de invoice e nunca altera
-- subscriptions.status/período/cancelled_at nesta etapa — dunning/
-- cancelamento fica para uma etapa própria futura.
--
-- Ordem: só billing_invoices.last_gateway_event_at decide (nunca
-- updated_at, nunca now()) — comparação com `<=` descarta como evento
-- obsoleto, sem erro (esperado sob entrega "at-least-once" do gateway).
--
-- SECURITY DEFINER, search_path='', EXECUTE só para service_role: quem
-- chama esta função é o Route Handler do webhook autenticado como
-- service_role (mesmo padrão de payment_webhook_events), nunca um usuário
-- comum — por isso não há is_tenant_member()/has_permission() aqui, e
-- tenant_id nunca é parâmetro.
create function public.apply_billing_webhook_event(
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

  -- SUBSCRIPTION_*: nenhum lookup de invoice, nenhuma escrita em
  -- subscriptions nesta etapa. O payload bruto já foi registrado em
  -- billing_webhook_events antes desta chamada.
  if p_event_type like 'SUBSCRIPTION_%' then
    return 'noop_subscription_event';
  end if;

  if p_event_type not in ('PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED') then
    -- Evento desconhecido: nunca levanta erro.
    return 'noop_unknown_event';
  end if;

  -- PAYMENT_RECEIVED (fundos liquidados) nunca ativa nada — a ativação já
  -- aconteceu em PAYMENT_CONFIRMED. Nunca avança last_gateway_event_at:
  -- nenhum efeito real foi aplicado.
  if p_event_type = 'PAYMENT_RECEIVED' then
    return 'noop_payment_received';
  end if;

  -- Todo PAYMENT_* remanescente exige gateway_invoice_id — nunca
  -- aproximação quando ausente.
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
    -- A invoice já nasce PENDING via create_billing_invoice (Etapa
    -- 20.2.6) antes do gateway confirmar a criação do pagamento — nada a
    -- transicionar no fluxo de 1ª cobrança suportado hoje.
    return 'noop_already_pending';
  end if;

  if p_event_type = 'PAYMENT_CONFIRMED' then
    if v_invoice.status <> 'PENDING' then
      -- Estado terminal já resolvido por outro caminho — evento fora de
      -- ordem ou reentrega tardia. Nunca reverte PAID/FAILED/CANCELLED/
      -- REFUNDED.
      return 'skipped_stale_event';
    end if;

    update public.billing_invoices
    set status = 'PAID',
        paid_at = p_gateway_event_at,
        confirmed_by_event_id = p_webhook_event_id,
        last_gateway_event_at = p_gateway_event_at
    where id = v_invoice.id;

    -- Assinatura localizada exclusivamente por (gateway,
    -- gateway_subscription_id) — nunca por tenant_id (não é parâmetro
    -- desta função) — com checagem cruzada contra invoice.subscription_id
    -- antes de qualquer escrita.
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
      -- Sem gateway_subscription_id no evento (não deveria ocorrer no
      -- fluxo suportado hoje): usa o FK já validado pelo match exato da
      -- invoice, nunca tenant_id.
      select * into v_subscription from public.subscriptions where id = v_invoice.subscription_id for update;
      if not found then
        raise exception 'apply_billing_webhook_event: invoice.subscription_id % has no subscriptions row', v_invoice.subscription_id
          using errcode = 'P0002';
      end if;
    end if;

    update public.subscriptions
    set status = 'active',
        current_period_start = v_invoice.period_start,
        current_period_end = v_invoice.period_end
    where id = v_subscription.id and status <> 'active';

    -- Conversão do trial: um tenant que confirma a 1ª cobrança de
    -- billing deixa de estar "em trial" — trial_records é a ÚNICA fonte
    -- de trial (Etapa 3), então esta função nunca infere status por
    -- subscriptions.trial_start/trial_end (só espelho informativo, Etapa
    -- 16). Só transiciona active→converted; nunca toca um trial já
    -- expired (não "reabre" nem reescreve um estado que não é o que esta
    -- função tem autoridade para decidir).
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

  -- Inalcançável dado o filtro de event_type acima — mantido só por
  -- segurança de tipo (toda branch anterior retorna).
  return 'noop_unknown_event';
end;
$$;

comment on function public.apply_billing_webhook_event(text, text, uuid, timestamptz, text, text) is
  'Etapa 20.2.7.1 — aplica um evento de webhook de BILLING já registrado em billing_webhook_events (idempotência resolvida ANTES desta chamada, via UNIQUE(provider, event_id)). PAYMENT_* exige match exato de (gateway, gateway_invoice_id) — nunca aproxima invoice, nunca cria uma que não existe. SUBSCRIPTION_* nunca altera subscriptions nesta etapa. PAYMENT_CONFIRMED é o único gatilho de ativação e de conversão de trial_records (active→converted). Chamada só por service_role.';

revoke execute on function public.apply_billing_webhook_event(text, text, uuid, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.apply_billing_webhook_event(text, text, uuid, timestamptz, text, text) to service_role;
