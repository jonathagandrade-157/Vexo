-- D12.2.1 — distingue "etapa concluída de fato" de "etapa pulada
-- conscientemente" em public.onboarding_progress (migration 20260817220094).
-- `completed_at` continua existindo e continua sendo gravado nos dois
-- casos (é só "quando esta linha foi resolvida", nunca reescrito) —
-- `status` é quem diz COMO foi resolvida. Nenhuma feature (products,
-- categories, tenants de aparência/pagamento/entrega) é lida para inferir
-- isso — a única fonte é a ação explícita do lojista ("Continuar" vs
-- "Pular por enquanto", features/onboarding/actions.ts).
--
-- Default 'completed' no backfill: qualquer linha pré-existente (do
-- modelo anterior, D12.2, que só sabia representar "concluído") só podia
-- significar isso — nunca existiu um jeito de gravar "pulado" antes desta
-- migration.
alter table public.onboarding_progress
  add column status text not null default 'completed'
    check (status in ('completed', 'skipped'));

comment on column public.onboarding_progress.status is
  '''completed'' = o lojista de fato preencheu/confirmou a etapa; ''skipped'' = o lojista escolheu "Pular por enquanto" (D12.2.1) — nunca inferido a partir de produtos/categorias/pagamento/entrega existirem ou não, sempre a ação explícita registrada em features/onboarding/actions.ts. ''skipped'' satisfaz o requisito de progresso para completar o onboarding (quando a etapa permite ser pulada), mas nunca significa que a feature correspondente foi configurada.';
