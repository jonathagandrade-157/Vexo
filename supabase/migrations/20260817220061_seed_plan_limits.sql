-- Etapa 14 (ajuste arquitetural) — seed de limites: só `products_limit`,
-- exatamente o exemplo com valores dados explicitamente no pedido
-- (BASIC=100, INTERMEDIATE=1000, PRO=-1/ilimitado) — nenhum outro
-- limit_key ganha valor inventado (só `products_limit` teve número
-- concreto especificado). Novos limit_keys (users_limit,
-- orders_monthly_limit, etc.) são cadastrados pelo MASTER quando
-- fizerem sentido, sem migration nova.
insert into public.plan_limits (plan_id, limit_key, limit_value)
select id, 'products_limit', 100 from public.plans where slug = 'basic';

insert into public.plan_limits (plan_id, limit_key, limit_value)
select id, 'products_limit', 1000 from public.plans where slug = 'intermediate';

insert into public.plan_limits (plan_id, limit_key, limit_value)
select id, 'products_limit', -1 from public.plans where slug = 'pro';
