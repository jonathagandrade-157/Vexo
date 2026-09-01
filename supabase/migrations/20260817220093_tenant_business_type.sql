-- D12.2 — tenants.business_type (docs: relatório D12.1, arquitetura
-- recomendada §D/§G). Dirige qual definição de onboarding (`ONBOARDING_STEPS`,
-- features/onboarding/step-definitions.ts) o wizard usa para cada tenant.
--
-- Aceita já os 3 valores documentados em D12.1 ('restaurant', 'adega',
-- 'ecommerce') para não exigir uma segunda migration só para alargar o
-- CHECK quando os wizards de restaurant/adega forem implementados
-- (D12.3+) — mas esta etapa (D12.2) só implementa a definição de steps
-- para 'ecommerce'; escolher 'restaurant'/'adega' hoje deixa o tenant sem
-- nenhum wizard funcional (não há ONBOARDING_STEPS para eles ainda) —
-- por isso a UI desta etapa nem oferece essas opções ainda.
--
-- Nullable: tenants legados (onboarding já concluído antes desta etapa,
-- ou cadastro em andamento que ainda não chegou à etapa "Seu negócio")
-- ficam com business_type = null. `recomputeOnboardingCompletion`
-- (features/onboarding/progress.ts) e `resolveOnboardingTenant`
-- continuam funcionando para eles sem exigir este campo — ver a regra de
-- compatibilidade "legacy" no código, não replicada aqui via CHECK
-- porque é uma decisão de aplicação, não de integridade de dados.
--
-- Sem policy de RLS nova: é só mais uma coluna em `tenants`, já protegida
-- pela policy de UPDATE existente (migration 20260817220012 — "tenant
-- staff with settings.update can update their tenant") — RLS do Postgres
-- filtra linha, não coluna, mesmo raciocínio já documentado na migration
-- 20260817220018 (tenant_brand_info).
alter table public.tenants
  add column business_type text
    check (business_type in ('restaurant', 'adega', 'ecommerce'));

comment on column public.tenants.business_type is
  'Tipo de negócio, escolhido na etapa "seu-negocio" do onboarding (D12.2). NULL = tenant legado (onboarding concluído antes desta etapa) ou onboarding ainda não iniciado/incompleto até essa etapa. Determina qual ONBOARDING_STEPS (features/onboarding/step-definitions.ts) o wizard usa. Só ''ecommerce'' tem wizard implementado nesta etapa — restaurant/adega ficam para D12.3+.';
