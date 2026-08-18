-- Etapa 12 — solta o `shipping_total = 0` da Etapa 10/11 (exatamente
-- como já estava documentado que aconteceria: "uma migration futura
-- solta este check quando frete for aprovado") e adiciona o snapshot da
-- modalidade escolhida — orders já existia (Etapa 10), nada duplicado.
-- discount_total continua forçado a 0 (cupom/desconto fora do escopo
-- desta etapa) e o check `total = subtotal + shipping_total -
-- discount_total` (Etapa 10) já garante consistência sem mudança.
alter table public.orders drop constraint orders_shipping_total_check;
alter table public.orders add constraint orders_shipping_total_check check (shipping_total >= 0);

alter table public.orders
  add column shipping_method text,
  add column shipping_provider text,
  add column shipping_estimated_days integer,
  -- Referência à modalidade escolhida (id, texto) — não é FK: o
  -- registro em shipping_methods pode ser excluído/alterado depois,
  -- mas o pedido preserva seu próprio snapshot (nome/preço/prazo já
  -- estão em shipping_method/shipping_total/shipping_estimated_days),
  -- mesmo princípio de order_items (Etapa 10).
  add column shipping_reference text;
