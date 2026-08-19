# Etapa 14 — Planos, Recursos e Fundação Comercial (ajuste arquitetural)

Este documento cobre especificamente a arquitetura pedida no ajuste da Etapa 14: separação MASTER/lojista/loja pública/índice, `plans`/`features`/`plan_features`/`plan_limits`, `tenant_access_status`/`tenant_has_feature`/`tenant_plan_limit`, `FeatureGate`/`UpgradeCta`, e a relação com uma futura assinatura/índice comercial. Complementa (não substitui) `docs/architecture/etapa-14-fundacao-comercial.md`, que documenta a implementação original desta etapa antes deste ajuste.

## As quatro interfaces da VEXO

```
VEXO
│
├── Índice/site institucional (/)         ← apresentação, planos, CTA — NÃO implementado nesta etapa
├── Painel MASTER (/master)                ← administração da plataforma inteira
├── Painel do lojista (/painel)            ← administração da própria loja (por tenant)
└── Loja pública (/loja/[slug])            ← storefront de cada tenant, multi-tenant
```

As quatro permanecem tecnicamente na mesma aplicação Next.js (não três apps separados, conforme instruído — "não criar três aplicações independentes nesta etapa"), mas com gates, RLS e identidade visual claramente distintos:

- **`/master`**: gate único em `app/master/layout.tsx`, exige `getCurrentPlatformAdmin()` (reaproveita `platform_admins`/`is_platform_admin()`, Etapa 2). Shell visual próprio (`components/master/*`, acento `tertiary`/âmbar) — nunca uma cópia do painel do lojista.
- **`/painel`**: gate em `app/painel/layout.tsx` (Etapa 5, inalterado), escopado ao tenant da sessão. Ainda não consulta `tenant_has_feature`/`tenant_plan_limit` em nenhuma página real — a infraestrutura existe (`FeatureGate`), mas nada foi retrofitado (decisão deliberada, evita expandir escopo sem uma feature real para gatear).
- **`/loja/[slug]`**: inalterado desde a Etapa 6, continua multi-tenant, RLS pública de sempre.
- **`/` (índice)**: **não alterado nesta etapa** — permanece a landing page placeholder da Etapa 1. A arquitetura foi preparada (ver seção "Preparação para o índice público" abaixo) para que uma etapa futura monte a seção de planos a partir do banco, sem exigir nenhuma mudança de RLS quando isso acontecer.

## `plans` / `features` / `plan_features`

Sem alteração de desenho desde a implementação original desta etapa — ver `etapa-14-fundacao-comercial.md` para o detalhamento completo. Resumo: catálogo global (não tenant-scoped), sem herança entre planos no banco, presença de linha em `plan_features` = recurso liberado.

## `plan_limits` — feature ≠ limite

**Feature** é uma capacidade booleana ("pode usar relatórios"). **Limite** é uma capacidade numérica ("pode cadastrar até 500 produtos"). São conceitos diferentes por design, então vivem em tabelas diferentes — `plan_limits` nunca reaproveita `plan_features`.

```sql
plan_limits (
  id, plan_id, limit_key, limit_value, created_at, updated_at,
  unique (plan_id, limit_key)
)
```

- `limit_value = -1` é o sentinel documentado para **ilimitado**.
- A **ausência** da linha (plano sem aquela `limit_key` configurada) significa **"sem limite definido ainda"** — semanticamente diferente de `-1`. `tenant_plan_limit()` retorna `NULL` nesse caso, nunca `-1` por padrão, para que quem consome a função decida o que fazer com "não configurado" (ex.: aplicar um teto padrão) em vez do banco decidir por ela.
- `limit_key` é texto livre (snake_case, `CHECK`) — sem catálogo/tabela própria de chaves reconhecidas (diferente de `features`, que tem `key` centralizada). O MASTER cadastra a chave que precisar direto na tela do plano, sem migration nova — mesmo princípio de extensibilidade já usado em `features`.
- **Acesso exclusivo do MASTER** — diferente de `plans`/`features`/`plan_features` (que qualquer `authenticated`, e agora também `anon`, pode ler quando ativos/publicados): `plan_limits` não tem nenhuma policy de leitura para `authenticated` geral nem para `anon`. É considerado dado operacional interno nesta etapa (nenhuma tela do lojista o exibe ainda).
- Seed: só `products_limit` (BASIC=100, INTERMEDIATE=1000, PRO=-1) — os únicos valores numéricos dados explicitamente no pedido; nenhum outro `limit_key` ganhou número inventado.

### `private.tenant_plan_limit(tenant_id, limit_key)`

Mesma forma de `tenant_has_feature`: `SECURITY DEFINER`, guarda de autorização idêntica (`is_tenant_member` ou `is_platform_admin`, senão `NULL`), lê a `subscription` do tenant e o `plan_limits` do plano correspondente. Só a **leitura** é exposta — a tabela em si segue MASTER-only mesmo para o próprio tenant consultar seu número (mesmo padrão de `tenant_has_feature` consultando `plan_features` sem dar acesso direto a ela).

## `tenant_access_status()` — sem duplicar trial

Inalterado desde a implementação original: `tenants.status` → `subscriptions.status` → `trial_records` (Etapa 3, preservada). As novas colunas `subscriptions.trial_start`/`trial_end` (nulas, preparatórias) **não** entram nessa função — `trial_records` continua sendo a única fonte de trial em uso. Nenhum sistema paralelo de trial foi criado.

## `tenant_has_feature()` — fonte única de feature gating

Inalterado desde a implementação original. Fecha em `false` para: chamador sem relação com o tenant; `tenant_access_status` fora de `ACTIVE`/`TRIALING`; tenant sem `subscription`; ou recurso desativado globalmente.

## `FeatureGate` / `UpgradeCta`

Inalterados — Server Component que chama `tenant_has_feature` via RPC e renderiza os `children` ou o `UpgradeCta` (mensagem clara de upgrade, nunca um erro técnico, nunca quebra a aplicação). Continuam sem uso em nenhuma página real do painel do lojista — infraestrutura pronta para quando a primeira feature realmente precisar ser gateada.

## Preparação para o índice público

`plans`, `features` e `plan_features` ganharam policies de `SELECT` para `anon`, escopadas a `is_active = true` (mesmo princípio de menor privilégio já usado para `products`/`categories` desde a Etapa 7) — exatamente o que uma futura página `/` precisará para montar a seção de planos **sem lista de preços duplicada/hardcoded**, consultando o mesmo dado que o MASTER cadastra em `/master/planos`. `plan_limits` deliberadamente não ganhou essa abertura (seção acima).

## Relação futura com assinatura real

```
Índice VEXO → Escolha do plano → Cadastro → Trial de 30 dias → Assinatura →
Pagamento recorrente → subscription → tenant_access_status() →
liberação/bloqueio das features → Painel do lojista
```

Este fluxo **não é implementado** nesta etapa — só a fundação (`plans`/`subscriptions`/`tenant_access_status`) já está pronta para que uma etapa futura o construa em cima, sem reescrever o que já existe. `subscriptions.trial_start`/`trial_end` (novas, nulas) existem para o cenário em que uma assinatura já vinculada a um plano específico precise de sua própria janela de trial (ex.: trial de um upgrade) — cenário ainda não implementado, colunas ainda não escritas por nenhum código.

## Segurança

- `plans`/`features`/`plan_features`: escrita exclusiva `is_platform_master()`; leitura de itens ativos liberada a `authenticated` e `anon`.
- `plan_limits`: leitura **e** escrita exclusivas `is_platform_master()` — nenhuma exceção.
- `tenant_has_feature`/`tenant_plan_limit`/`tenant_access_status`: todas fecham em valor seguro (`false`/`NULL`/`CANCELLED`) para quem não é membro do tenant nem platform admin — nunca vazam dado de um tenant alheio.
- O lojista nunca altera o próprio plano, nunca libera um recurso para si, nunca altera um limite — confirmado por RLS (não só pela Server Action) e testado explicitamente.

## Decisões deliberadamente fora do escopo

- Nenhum bloqueio funcional real usando `plan_limits` (ex.: impedir cadastrar o 101º produto no plano Básico) — só a arquitetura de consulta existe.
- Nenhuma página `/` comercial completa — permanece a landing page da Etapa 1; só a RLS foi preparada.
- Nenhuma cobrança, gateway de assinatura, webhook, upgrade/downgrade pago, ou qualquer alteração no Mercado Pago da Etapa 11 (que continua exclusivamente para os pedidos do lojista, nunca para a assinatura da VEXO).
- Nenhum catálogo centralizado de `limit_key`s reconhecidas (diferente de `features.key`) — decisão deliberada de manter `plan_limits` simples (texto livre) nesta fundação.
