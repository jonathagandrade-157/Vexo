-- Fase D2-B.3 — gestão de pedidos: confirmação manual de pagamento
-- externo (PIX direto/dinheiro/cartão via WhatsApp). Auditoria D2-B.3
-- encontrou que, hoje, um pedido `payment_channel='external'` fica preso
-- para sempre em `orders.status='PENDING'`/`payment_status='EXTERNAL'`:
-- `apply_payment_update` (migration 043) é a ÚNICA função que grava
-- `status='PAID'`, e é `service_role`-only (webhook Mercado Pago) — nunca
-- chamada para pedidos externos. `update_order_status` (migration 051)
-- também não ajuda: sua máquina de estados só permite `PENDING →
-- CANCELLED`. Resultado: nenhum pedido WhatsApp pode avançar além de
-- cancelado, mesmo depois do lojista efetivamente receber o pagamento.
--
-- Corrige com uma nova função, análoga a `apply_payment_update` mas
-- callable por `authenticated` (nunca `anon`/`service_role`), estritamente
-- restrita a `payment_channel='external'` — nunca usável para Mercado
-- Pago (que continua exclusivamente sob `apply_payment_update`/webhook,
-- nenhuma linha alterada aqui).
--
-- Decisão de produto (auditoria D2-B.3): permissão exigida é a
-- INTERSEÇÃO de `orders.update` E `payments.view` — nenhuma permission
-- nova criada.
--
-- ACHADO DURANTE A IMPLEMENTAÇÃO (não previsto na auditoria): a
-- constraint `orders_payment_channel_status_consistency` (migration 079)
-- hoje proíbe QUALQUER `payment_status` diferente de `'EXTERNAL'` quando
-- `payment_channel='external'` — a UPDATE que esta função precisa fazer
-- (`payment_status: EXTERNAL → APPROVED`) violaria essa constraint tal
-- como ela existe hoje. Precisa ser estendida (não removida): continua
-- proibindo tudo que não seja EXTERNAL/APPROVED para o canal externo
-- (nunca PENDING/REJECTED/CANCELLED/REFUNDED, que são conceitos
-- exclusivos do fluxo gateway), e continua proibindo EXTERNAL fora do
-- canal externo.
alter table public.orders drop constraint orders_payment_channel_status_consistency;
alter table public.orders add constraint orders_payment_channel_status_consistency check (
  (payment_channel = 'external' and payment_status in ('EXTERNAL', 'APPROVED'))
  or (payment_channel = 'gateway' and payment_status <> 'EXTERNAL')
);

create function public.confirm_external_payment(
  p_tenant_id uuid,
  p_order_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_has_orders_update boolean;
  v_has_payments_view boolean;
begin
  -- Interseção das duas permissões — nunca uma OU outra sozinha (decisão
  -- de produto explícita: orders.update sem payments.view, ou vice-versa,
  -- não é suficiente para confirmar dinheiro entrando na loja).
  select private.has_permission(p_tenant_id, 'orders.update') into v_has_orders_update;
  select private.has_permission(p_tenant_id, 'payments.view') into v_has_payments_view;
  if not (
    (coalesce(v_has_orders_update, false) and coalesce(v_has_payments_view, false))
    or private.is_platform_admin()
  ) then
    raise exception 'insufficient permission to confirm this payment' using errcode = '42501';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'a reason is required to confirm an external payment' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id and tenant_id = p_tenant_id;
  if v_order.id is null then
    raise exception 'order not found for this store' using errcode = 'P0002';
  end if;

  -- Nunca usável para o caminho gateway — Mercado Pago continua
  -- exclusivamente sob apply_payment_update/webhook, nunca sob controle
  -- manual do lojista.
  if v_order.payment_channel <> 'external' then
    raise exception 'confirm_external_payment can only be used for external payment orders' using errcode = 'P0001';
  end if;

  -- Idempotente: se já não está mais em EXTERNAL (já confirmado por uma
  -- chamada anterior, ou qualquer outro estado), não é erro — só não há
  -- nada a fazer. Nunca duplica o log de auditoria nem re-aplica a
  -- transição de status.
  if v_order.payment_status <> 'EXTERNAL' then
    return;
  end if;

  -- Leitura-validação-escrita atômica (mesma técnica de
  -- update_order_status, migration 051): a condição extra
  -- `payment_status = 'EXTERNAL'` no WHERE garante que, entre duas
  -- chamadas concorrentes que carregaram o mesmo v_order, só a primeira
  -- efetivamente escreve — a segunda não encontra a linha (não está mais
  -- em EXTERNAL) e sai sem efeito, sem erro.
  --
  -- Nunca altera orders.status para um valor arbitrário: só PENDING→PAID,
  -- e só quando o pedido ainda estava em PENDING — se já tiver avançado
  -- (ex.: um lojista já moveu manualmente para PREPARING por engano antes
  -- de confirmar o pagamento — cenário que a máquina de estados de
  -- update_order_status já não permitiria a partir de PENDING, mas fica
  -- registrado aqui por clareza), o status do pedido não é tocado.
  update public.orders
  set payment_status = 'APPROVED',
      status = case when status = 'PENDING' then 'PAID' else status end
  where id = p_order_id and tenant_id = p_tenant_id and payment_status = 'EXTERNAL';

  if not found then
    return;
  end if;

  -- Evento específico (nunca ORDER_STATUS_CHANGED, que já é logado
  -- automaticamente pelo trigger existente quando PENDING→PAID muda —
  -- este é sobre o FATO do pagamento, não o status do pedido).
  -- `p_reason` vai para a coluna `reason` de audit_logs, já existente e
  -- documentada desde a Etapa 2 especificamente para "override manual de
  -- status financeiro/pagamento exige motivo" — nenhuma tabela nova.
  perform private.log_audit(
    p_tenant_id, 'ORDER_PAYMENT_CONFIRMED', 'order', p_order_id::text,
    jsonb_build_object('payment_status', 'EXTERNAL'),
    jsonb_build_object('payment_status', 'APPROVED'),
    p_reason
  );
end;
$$;

comment on function public.confirm_external_payment(uuid, uuid, text) is
  'Confirmação manual de pagamento externo (PIX direto/dinheiro/cartão via WhatsApp) pelo lojista. Nunca usável para payment_channel=gateway (Mercado Pago continua exclusivamente sob apply_payment_update/webhook). Exige orders.update E payments.view (interseção). Idempotente, atômica contra concorrência, sempre exige e registra motivo em audit_logs.';

revoke execute on function public.confirm_external_payment(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.confirm_external_payment(uuid, uuid, text) to authenticated;
