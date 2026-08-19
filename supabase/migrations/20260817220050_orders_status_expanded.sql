-- Etapa 13 — gestão de pedidos: alarga orders.status para os estados de
-- ciclo de vida pós-pagamento, exatamente a migration futura que já
-- estava documentada desde a Etapa 10 ("cresce por migration quando os
-- próximos estados forem aprovados"). payment_status (Etapa 11)
-- permanece intocado — status comercial/operacional e status de
-- pagamento continuam campos separados, cancelar um pedido nunca
-- altera o outro.
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('PENDING', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED'));

-- Nota interna do lojista, opcional, anexada à transição de status mais
-- recente (não é um campo de comunicação com o cliente — nunca exposto
-- por get_order_confirmation nem em nenhuma leitura pública/anon). O
-- histórico completo de notas por transição já fica em audit_logs
-- (migration seguinte); esta coluna é só "a nota mais recente", para
-- exibição rápida no detalhe do pedido — não um log paralelo.
alter table public.orders add column internal_note text check (internal_note is null or char_length(internal_note) <= 500);
