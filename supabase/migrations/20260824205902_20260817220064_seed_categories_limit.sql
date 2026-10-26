-- Etapa 16 §6/§10 — segundo limit_key real (o primeiro, products_limit,
-- é da Etapa 14). Valores de categories_limit pedidos explicitamente no
-- prompt: BASIC 10, INTERMEDIATE 50, PRO ilimitado (-1, mesmo sentinel de
-- products_limit).
insert into public.plan_limits (plan_id, limit_key, limit_value)
select id, 'categories_limit', 10 from public.plans where slug = 'basic';

insert into public.plan_limits (plan_id, limit_key, limit_value)
select id, 'categories_limit', 50 from public.plans where slug = 'intermediate';

insert into public.plan_limits (plan_id, limit_key, limit_value)
select id, 'categories_limit', -1 from public.plans where slug = 'pro';

-- O prompt da Etapa 16 (§6) também redefine explicitamente os números de
-- products_limit — BASIC 50 (era 100 na Etapa 14) e INTERMEDIATE 500 (era
-- 1000). PRO continua -1/ilimitado, sem mudança. Migrations anteriores não
-- são editadas (histórico imutável); o valor corrente é ajustado aqui, por
-- cima, exatamente como o MASTER faria manualmente pela UI de
-- `/master/planos/[id]` — nenhuma lógica nova, só o dado.
update public.plan_limits pl
set limit_value = 50
from public.plans p
where pl.plan_id = p.id and p.slug = 'basic' and pl.limit_key = 'products_limit';

update public.plan_limits pl
set limit_value = 500
from public.plans p
where pl.plan_id = p.id and p.slug = 'intermediate' and pl.limit_key = 'products_limit';
