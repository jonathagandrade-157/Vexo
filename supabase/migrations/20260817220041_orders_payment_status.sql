-- Etapa 11 — separa status do PEDIDO de status do PAGAMENTO (prompt
-- Etapa 11 §9) — coluna nova em orders (tabela já existente da Etapa
-- 10, não duplicada). orders.status ganha exatamente UM valor novo,
-- 'PAID', exatamente como a Etapa 10 já previa ("cresce por migration
-- quando os próximos estados forem aprovados") — nada além disso: a
-- máquina de estados completa (Preparando/Enviado/Entregue) continua
-- fora do escopo.
alter table public.orders
  add column payment_status text not null default 'PENDING'
    check (payment_status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED'));

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('PENDING', 'PAID'));
