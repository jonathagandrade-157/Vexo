-- Etapa 10 — RLS de orders/order_items. Reaproveita `orders.view`
-- (já existia desde a Etapa 2, concedida a OWNER/ADMIN/MANAGER/
-- OPERATOR — não cria permissão nova). Só leitura para staff nesta
-- etapa: a gestão de pedidos (/painel/pedidos) continua "coming soon",
-- fora do escopo — não há UPDATE/DELETE policy porque nada ainda
-- precisa escrever nessas tabelas por essa via.
--
-- Sem NENHUMA policy para `anon`: criação passa só por
-- create_order_from_cart() e leitura da confirmação só por
-- get_order_confirmation() (ambas security definer, migration
-- seguinte) — mesma razão de sempre (lição da Etapa 6: nunca alargar
-- RLS "para facilitar"; aqui nem alargar é necessário, já que as
-- funções cobrem os dois únicos casos de uso do visitante anônimo).
create policy "tenant staff with orders.view can select orders"
  on public.orders for select
  to authenticated
  using (private.has_permission(tenant_id, 'orders.view') or private.is_platform_admin());

create policy "tenant staff with orders.view can select order items"
  on public.order_items for select
  to authenticated
  using (private.has_permission(tenant_id, 'orders.view') or private.is_platform_admin());
