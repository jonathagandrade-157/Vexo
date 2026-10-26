-- JON-15 — reconciliação de webhook de pagamento perdido (Mercado Pago).
--
-- list_stale_pending_gateway_payments: única leitura nova exigida pelo
-- cron de reconciliação (lib/payments/reconcile.ts). Devolve
-- (tenant_id, order_id) de pedidos pagos pelo gateway (nunca canal
-- 'external' — esses nunca têm webhook nenhum pra perder, payment_status
-- fica travado em 'EXTERNAL' por design, D2-B) cujo pagamento continua
-- PENDING depois da janela combinada. `p_limit` (sempre passado pelo
-- chamador, sem default aqui de propósito — nunca um teto implícito
-- escondido) impede uma execução de tentar processar um número
-- ilimitado de pedidos de uma vez.
--
-- security definer + só service_role: mesmo padrão de apply_payment_update
-- (migration 20260817220043) — só o cron (via service_role) pode listar
-- isto; nem anon nem authenticated têm por que ver pedidos de OUTROS
-- tenants (RLS de payments/orders nunca libera isso pra staff mesmo).
create function public.list_stale_pending_gateway_payments(p_older_than timestamptz, p_limit integer)
returns table (tenant_id uuid, order_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.tenant_id, p.order_id
  from public.payments p
  join public.orders o on o.id = p.order_id
  where o.payment_channel = 'gateway'
    and p.status = 'PENDING'
    and p.created_at < p_older_than
  order by p.created_at asc
  limit p_limit;
$$;

comment on function public.list_stale_pending_gateway_payments(timestamptz, integer) is
  'JON-15 — pedidos pagos via gateway (nunca canal external) com pagamento PENDING há mais tempo que p_older_than, mais antigos primeiro, limitados a p_limit. Só leitura — a escrita da reconciliação em si continua exclusivamente via apply_payment_update (migration 20260817220043), nunca duplicada aqui.';

revoke execute on function public.list_stale_pending_gateway_payments(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.list_stale_pending_gateway_payments(timestamptz, integer) to service_role;
