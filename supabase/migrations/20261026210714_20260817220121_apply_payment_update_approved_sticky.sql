-- JON-15 — "aprovado é grudento": apply_payment_update (migration
-- 20260817220043) não tinha NENHUMA guarda de estado terminal — qualquer
-- chamada sobrescrevia payments.status/orders.payment_status incondicio-
-- nalmente, não importa o valor atual. Isso já era um bug latente no
-- caminho normal do webhook (não introduzido por esta migration): um
-- evento fora de ordem podia, em teoria, reverter um pedido já pago.
--
-- A reconciliação (JON-15, lib/payments/reconcile.ts +
-- searchPaymentByExternalReference) tornou esse risco concreto, não só
-- teórico: ela escolhe UM resultado entre potencialmente VÁRIAS tentativas
-- de pagamento do mesmo pedido no Mercado Pago (mesmo external_reference).
-- Se o cliente pagou com sucesso numa tentativa mais antiga e, por
-- qualquer motivo, tentou pagar de novo depois (tentativa mais nova,
-- rejeitada/cancelada), sem esta guarda a reconciliação aplicaria o
-- resultado errado e reverteria um pedido genuinamente pago.
--
-- Regra: uma vez que payments.status já é APPROVED, a ÚNICA transição
-- ainda aceita é para REFUNDED (estorno real, que acontece DEPOIS da
-- aprovação). Qualquer outro p_status (REJECTED/CANCELLED/PENDING) chegando
-- depois de um APPROVED é ignorado silenciosamente — mesmo padrão já usado
-- pela checagem de "valor divergente" logo abaixo. Toda transição que NÃO
-- parte de APPROVED continua exatamente como antes, incluindo
-- REJECTED/CANCELLED → APPROVED (o caso legítimo de retry bem-sucedido) e
-- a idempotência de reaplicar o mesmo APPROVED duas vezes.
create or replace function public.apply_payment_update(
  p_tenant_id uuid,
  p_order_id uuid,
  p_provider text,
  p_external_id text,
  p_status text,
  p_method text,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_payment public.payments;
begin
  select * into v_order from public.orders where id = p_order_id and tenant_id = p_tenant_id;
  if v_order.id is null then
    return; -- pedido não encontrado para este tenant — nada a aplicar, silenciosamente.
  end if;
  if abs(v_order.total - p_amount) > 0.01 then
    return; -- valor divergente — não aplica (prompt §17: "valor divergente").
  end if;

  select * into v_payment from public.payments where order_id = p_order_id and tenant_id = p_tenant_id and provider = p_provider;

  if v_payment.status = 'APPROVED' and p_status not in ('APPROVED', 'REFUNDED') then
    return; -- aprovado é grudento — só REFUNDED pode suceder um APPROVED.
  end if;

  update public.payments
  set external_id = p_external_id,
      status = p_status,
      method = p_method,
      paid_at = case when p_status = 'APPROVED' then now() else paid_at end
  where order_id = p_order_id and tenant_id = p_tenant_id and provider = p_provider;

  update public.orders
  set payment_status = p_status,
      status = case when p_status = 'APPROVED' and status = 'PENDING' then 'PAID' else status end
  where id = p_order_id and tenant_id = p_tenant_id;
end;
$$;

comment on function public.apply_payment_update(uuid, uuid, text, text, text, text, numeric) is
  'Escreve o resultado de um pagamento (webhook OU reconciliação, JON-15) — sempre o mesmo caminho de escrita para os dois. "Aprovado é grudento": uma vez payments.status=APPROVED, só REFUNDED é aceito depois; qualquer outro p_status chegando fora de ordem é ignorado silenciosamente (migration 20260817220121).';
