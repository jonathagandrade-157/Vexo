# Etapa 14 — Arquitetura Comercial, Planos, Recursos e Fundação do Painel MASTER

## Objetivo

Criar a fundação técnica/comercial que permitirá, em etapas futuras, planos pagos (mensal/anual), trial com expiração real, upgrade/downgrade, cobrança recorrente e bloqueio por inadimplência — **sem implementar nenhuma dessas coisas ainda**. Esta etapa é infraestrutura: planos e recursos existem no banco, feature gating funciona de ponta a ponta (backend autoritativo, frontend só reflete), e o Painel MASTER tem sua primeira fundação real.

## Duas ressalvas antes de qualquer coisa

1. **Sem cobrança real**: `plans.monthly_price`/`yearly_price` ficam `NULL` até o MASTER configurar. Nenhum gateway de assinatura foi integrado. `subscriptions` não tem nenhuma coluna de cobrança (sem `external_subscription_id`, sem `payment_method_id`) — entram por migration aditiva quando essa etapa futura existir.
2. **Dois Mercado Pago diferentes, nunca confundidos**: o Mercado Pago da Etapa 11 é do **lojista**, para receber pelos pedidos da própria loja. Uma futura cobrança de assinatura da VEXO (o SaaS cobrando do lojista) seria um fluxo **completamente separado**, ainda não implementado. Nada desta etapa toca `lib/payments/*` nem qualquer código da Etapa 11.

## Arquitetura — visão geral

```
                    ┌─────────────────────────────────────┐
                    │           plans (global)             │
                    │  slug, name, monthly/yearly_price,    │
                    │  trial_days, is_active, is_featured   │
                    └───────────────┬───────────────────────┘
                                    │ N:N (plan_features)
                    ┌───────────────▼───────────────────────┐
                    │          features (global)             │
                    │  key, name, category, is_active        │
                    └─────────────────────────────────────────┘

  tenant ──1:1── subscription ──N:1── plan
     │
     └── (sem subscription ainda) ──► trial_records (Etapa 3, preservada)

  private.tenant_access_status(tenant_id)
      → tenants.status ▸ subscriptions.status ▸ trial_records
  private.tenant_has_feature(tenant_id, feature_key)
      → membership/platform-admin ▸ access_status ▸ plan_features
```

Nenhuma herança entre planos no banco (PRO não é "INTERMEDIATE + coisas" em nenhuma query) — cada plano tem seus próprios relacionamentos em `plan_features`, permitindo planos personalizados no futuro sem alterar esta arquitetura.

## Tabelas criadas (4)

| Tabela | Escopo | Descrição |
|---|---|---|
| `plans` | Global | Catálogo de planos comerciais — preços nulos até serem definidos |
| `features` | Global | Catálogo de recursos, extensível (cadastrar = 1 INSERT, nunca uma coluna nova) |
| `plan_features` | Global (N:N) | Presença da linha = recurso liberado para o plano — sem coluna booleana |
| `subscriptions` | Por tenant | Associação corrente tenant↔plano, sem nenhuma coluna de cobrança real |

## Funções centrais (2, ambas a fonte única — nunca duplicadas em página nenhuma)

- **`private.tenant_access_status(tenant_id)`** → `ACTIVE | TRIALING | EXPIRED | SUSPENDED | CANCELLED`. Ordem de precedência: `tenants.status` (suspenso/excluído sempre vence) → `subscriptions.status`, se existir → `trial_records`, se não houver subscription ainda (preserva integralmente o mecanismo da Etapa 3, nunca duplicado). `past_due` é tratado como `ACTIVE` nesta etapa — não há política de bloqueio automático por inadimplência ainda (fora de escopo, prompt §9/§30).
- **`private.tenant_has_feature(tenant_id, feature_key)`** → boolean. Fecha em `false` (nunca assume acesso) quando: quem chama não é membro do tenant nem platform admin; `tenant_access_status` não é `ACTIVE`/`TRIALING`; o tenant não tem `subscription`; ou o recurso foi desativado globalmente pelo MASTER — mesmo que ainda esteja associado ao plano.

### Achado e corrigido durante a revisão de segurança (não só documentado)

A primeira versão de `tenant_access_status()` não tinha a mesma guarda de autorização que `tenant_has_feature()` já tinha desde o início — qualquer usuário autenticado (não precisava ser membro do tenant nem platform admin) conseguia chamar `tenant_access_status(<uuid de qualquer tenant>)` e descobrir se aquela loja estava `SUSPENDED`/`TRIALING`/`ACTIVE`/`EXPIRED`/`CANCELLED`, só sabendo o `id` — inclusive de um concorrente, sem nenhuma relação com a loja. Corrigido adicionando ao início da função a mesma checagem de `tenant_has_feature()`: `if not (private.is_tenant_member(p_tenant_id) or private.is_platform_admin()) then return 'CANCELLED'; end if;` — fecha em `CANCELLED` (o mesmo valor já usado para "tenant inexistente", nunca revela se o tenant é real ou qual seu estado de verdade) para qualquer chamador sem relação legítima. Coberto por teste de regressão dedicado, espelhando o teste equivalente que `tenant_has_feature()` já tinha.

Ambas têm wrapper `public.*` (RPC-chamável, `security invoker`, mesmo padrão de `public.has_permission` desde a Etapa 5), granted só a `authenticated`/`service_role`.

## Segurança e RLS

- **`private.is_platform_master()`** (nova, simétrica a `is_platform_support()` já existente) — `true` só para `platform_admins.role = 'MASTER'`, nunca `SUPPORT_AGENT`. Não é "um segundo sistema de administrador" (prompt §15) — é o mesmo `platform_admins` da Etapa 2, checando o outro valor do mesmo `role`.
- Escrita (INSERT/UPDATE/DELETE) em `plans`/`features`/`plan_features`/`subscriptions`: **exclusivamente `is_platform_master()`**. Nem o lojista, nem `SUPPORT_AGENT`, nem `service_role` sem essa checagem.
- Leitura: `plans`/`features` ativos são visíveis a qualquer `authenticated` (catálogo comercial, não é dado sensível — precisa estar visível para a UI de upgrade do lojista); `subscriptions` só para membros do próprio tenant ou platform admin.
- Todas as 4 tabelas com `force row level security`.
- Defesa em profundidade nas Server Actions (`requireMaster()`) — a autoridade final continua sendo RLS, mesmo padrão de todo o projeto desde a Etapa 5.

## Auditoria

`PLAN_CREATED`/`PLAN_UPDATED`/`PLAN_ACTIVATED`/`PLAN_DEACTIVATED`/`FEATURE_CREATED`/`FEATURE_UPDATED`/`PLAN_FEATURE_ENABLED`/`PLAN_FEATURE_DISABLED` — todos com `tenant_id = NULL` (não são eventos de um tenant específico; mesmo padrão já usado para `USER_CREATED` desde a Etapa 2, que `private.log_audit()` já trata sem exigir checagem cross-tenant quando o tenant é nulo). `TENANT_PLAN_CHANGED` é o único evento com `tenant_id` real, disparado na primeira atribuição de plano e em qualquer troca de `plan_id` (nunca em mudança só de `status`).

## Painel MASTER — fundação

Shell visual próprio (`components/master/*`), acento `tertiary` (âmbar) em vez do `primary` (roxo) do painel do lojista — reaproveita os mesmos tokens Tailwind, nunca copia o layout do lojista (prompt §33). Gate único em `app/master/layout.tsx`, reaproveitando `platform_admins`/`is_platform_admin()` (Etapa 2) via `getCurrentPlatformAdmin()` — sem sessão → `/login`; sessão sem platform_admins → `/painel` (não é erro, é devolver para onde a pessoa de fato tem acesso).

Implementado: `/master` (dashboard com contadores reais, sem MRR inventado), `/master/planos` (lista + criar/editar/ativar-desativar), `/master/planos/[id]` (a tela central do prompt §19 — checkboxes recurso↔plano, agrupados por categoria, salvando imediatamente), `/master/recursos` (lista + criar/editar). Rotas restantes do prompt §14 (`clientes`, `lojas`, `assinaturas`, `trials`, `configuracoes`) são `ComingSoon` reais, mesmo padrão do painel do lojista desde a Etapa 5 — nunca um link morto.

## Feature gating no painel do lojista

`components/painel/feature-gate.tsx` (Server Component) + `components/painel/upgrade-cta.tsx` — infraestrutura pronta, chamando `tenant_has_feature` via RPC. **Não usada por nenhuma página existente ainda** — nenhum recurso gateável (cupons, estoque, domínio, IA) existe de verdade nesta etapa; forçar o uso seria expandir escopo sem necessidade (prompt §20 pede a infraestrutura, "posteriormente mostrar").

## Seed inicial

3 planos (`basic`/`intermediate`/`pro`, preços `NULL`) e 27 recursos, com as associações exatas do exemplo do prompt §6 — BASIC (4 recursos: storefront/products/categories/orders), INTERMEDIATE (+coupons/inventory/shipping/reports, 8 no total), PRO (todos os 27).

## Testes

`tests/integration/commercial-foundation.test.ts` (17 cenários): CRUD de planos/recursos MASTER-only (lojista e `SUPPORT_AGENT` bloqueados), associação plano↔recurso MASTER-only, `subscriptions` nunca alterável pelo próprio tenant, isolamento entre tenants, feature gating real (`BASIC`/`INTERMEDIATE`/`PRO` × `coupons`/`vexo_ai`, batendo exatamente com o seed), `tenant_has_feature`/`tenant_access_status` fechando em valor seguro para quem não tem relação com o tenant (a regressão do achado de segurança acima) e para recurso desativado globalmente, `tenant_access_status` seguindo a precedência documentada (incluindo fallback para `trial_records`), grants `anon`-blocked nas duas funções públicas, e os 8 eventos de auditoria pedidos no prompt §27. Suíte completa: **286/286** (269 das Etapas 1–13 intactos + 17 novos).

## Limitações

- Nenhum tenant existente ganha uma `subscription` automaticamente — a associação é manual pelo MASTER. Sem gate nenhum das Etapas 1–13 depende disso hoje, então não há impacto funcional.
- `past_due` não bloqueia automaticamente (sem política de carência definida ainda).
- `FeatureGate` não está integrado a nenhuma página real — puramente infraestrutura pronta para uso futuro.

## Decisões pendentes

- Se/quando a cobrança real for implementada, decidir a política de carência para `past_due` (quantos dias até suspender automaticamente).
- Definir se `create_tenant()` (Etapa 2) deveria passar a criar uma `subscription` inicial automaticamente — deliberadamente fora do escopo desta etapa.

## Funcionalidades deliberadamente NÃO implementadas

Cobrança recorrente; qualquer gateway de assinatura (Mercado Pago/PagBank/Asaas/Stripe para a assinatura da VEXO); upgrade/downgrade pago; cancelamento financeiro; webhook de assinatura; domínio real; estoque; variantes; cupons; clientes; relatórios; IA; criação personalizada de lojas; notificações — todos citados no prompt como fora de escopo desta etapa, permanecem apenas como `features` cadastradas no catálogo (prontas para serem gateadas quando implementadas).
