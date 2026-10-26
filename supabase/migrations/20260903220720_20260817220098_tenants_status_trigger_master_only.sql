-- D15-S.1 — corrige o trigger private.prevent_unauthorized_tenant_status_change
-- (migration 20260817220012_rls_tenants.sql) para exigir especificamente
-- MASTER, não "qualquer platform admin".
--
-- DIAGNÓSTICO REAL (após auditoria completa de RLS + GRANTs + triggers +
-- RPCs + testes existentes — a auditoria de segurança D15-S original
-- relatou este ponto como "OWNER/ADMIN pode contornar update_tenant_status
-- via UPDATE direto"; essa parte específica do relato estava
-- **incorreta**: a policy de UPDATE de `tenants` (migration 012) por si só
-- permitiria isso, mas o trigger `prevent_unauthorized_tenant_status_change`
-- — criado NA MESMA migration 012, e que a auditoria original não chegou a
-- inspecionar — já bloqueia qualquer role que não seja platform admin de
-- mudar `status`, independentemente de `settings.update`. Os testes
-- "[extra] an OWNER cannot change their own tenant's status (MASTER-only)"
-- (tests/integration/rls-isolation.test.ts) e "a tenant's own OWNER cannot
-- change its status — neither via the RPC nor via a direct UPDATE"
-- (tests/integration/master-tenants.test.ts) já cobrem exatamente esse
-- cenário e já o esperam bloqueado.
--
-- O gap REAL, confirmado por leitura direta do código em produção: o
-- trigger checa `private.is_platform_admin()` (MASTER OU SUPPORT_AGENT,
-- migration 20260817220009), não `private.is_platform_master()` (só
-- MASTER, migration 20260817220052 — que só passou a existir DEPOIS do
-- trigger, Etapa 14 vs. Etapa 2, e nunca foi retroaplicada aqui).
-- `public.update_tenant_status` (migration 20260817220069) já usa
-- `is_platform_master()` e o próprio comentário dessa função documenta a
-- intenção: "Nunca chamável por SUPPORT_AGENT nem pelo próprio lojista" —
-- e o docblock de tests/integration/master-tenants.test.ts repete a mesma
-- exigência ("nunca SUPPORT_AGENT ... nem via a RPC nem via UPDATE
-- direto"). Hoje, só a RPC cumpre isso; o trigger (a "segunda camada"
-- que deveria fechar exatamente esse tipo de desvio) ainda deixa
-- SUPPORT_AGENT mudar `status` via UPDATE direto — nunca testado
-- (o teste existente de SUPPORT_AGENT só exercita o caminho da RPC).
--
-- CORREÇÃO: troca o único ponto do trigger que decide "quem pode mudar
-- status" de is_platform_admin() para is_platform_master() — mesma
-- função, mesma assinatura (STABLE SECURITY DEFINER, search_path vazio,
-- já usada em produção por update_tenant_status/RLS de plans/features),
-- já concedida a `authenticated` (migration 052). Nenhuma outra linha do
-- trigger muda.
--
-- Por que isto NÃO quebra nada legítimo:
--   - Nenhum dos ~9 Server Actions que hoje fazem UPDATE em `tenants`
--     (features/settings/actions.ts, pix-actions.ts, checkout-actions.ts,
--     address-actions.ts, appearance-actions.ts, whatsapp-actions.ts,
--     features/onboarding/actions.ts ×2, features/onboarding/progress.ts)
--     toca a coluna `status` — a condição `old.status is distinct from
--     new.status` do trigger continua `false` para todos eles,
--     exatamente como antes.
--   - MASTER continua passando (is_platform_master() = true) — preserva
--     tanto o fluxo via RPC quanto o UPDATE direto que
--     tests/integration/rls-isolation.test.ts ("[extra] a platform admin
--     (MASTER) can change tenant status, and it is audited") e
--     tests/integration/storefront.test.ts já exercitam e esperam
--     funcionando (é comportamento deliberado, não um bug — MASTER como
--     via de escape administrativa direta, auditada pelo trigger
--     audit_tenant_changes já existente, além do caminho normal validado
--     pela máquina de estados da RPC).
--   - OWNER/ADMIN continuam bloqueados (já bloqueados antes desta
--     migration, nenhuma mudança de comportamento para eles).
--   - SUPPORT_AGENT passa a ser bloqueado também no UPDATE direto — único
--     comportamento que de fato muda, fechando o gap e alinhando o
--     trigger à mesma regra que a RPC e a documentação já declaravam.
create or replace function private.prevent_unauthorized_tenant_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and not private.is_platform_master() then
    raise exception
      'tenants.status can only be changed by a platform admin'
      using errcode = '42501'; -- insufficient_privilege
  end if;
  return new;
end;
$$;

comment on function private.prevent_unauthorized_tenant_status_change() is
  'D15-S.1: exige private.is_platform_master() (só MASTER), não mais private.is_platform_admin() (MASTER OU SUPPORT_AGENT) — alinha esta segunda camada de defesa à mesma regra que public.update_tenant_status (20260817220069) já aplica. Sem SECURITY DEFINER: só chama private.is_platform_master(), que já resolve seu próprio contexto de segurança — não há necessidade de elevar privilégio aqui (arquitetura §14: minimizar uso de DEFINER).';
