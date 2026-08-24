# Etapa 16 — Enforcement Real de Planos + Limites

Transforma a fundação comercial da Etapa 14 (`plans`/`features`/`plan_features`/`plan_limits`/`subscriptions`, `tenant_access_status`/`tenant_has_feature`/`tenant_plan_limit`, `FeatureGate`/`UpgradeCta`, Painel MASTER) em bloqueio de verdade. Nenhuma migration/tabela nova de domínio comercial — só o que faltava para a fundação já existente funcionar de fato.

## A lacuna que bloqueava tudo

Auditando o código antes de implementar, a Etapa 14 tinha uma decisão deliberada e documentada: `subscriptions` nunca era criada automaticamente ("Não é uma linha criada automaticamente por `create_tenant()`" — comentário original da migration `20260817220054`). Isso era intencional para `tenant_access_status()` (que cai para `trial_records` sem problema), mas **`tenant_has_feature()` e `tenant_plan_limit()` exigem uma `subscriptions.plan_id` para responder qualquer coisa** — sem ela, retornam sempre `false`/`NULL`. Como nada criava essa linha, **todo tenant em trial (a esmagadora maioria hoje) tinha zero features e zero limites configurados**, tornando enforcement real impossível.

### Correção: `link_trial_to_subscription` (migration `20260817220063`)

Trigger `AFTER INSERT ON trial_records`, aditivo — não altera `start_trial_for_tenant()` nem nenhuma lógica da Etapa 3. Cria a `subscriptions` row que faltava (plano **BASIC**, status `trialing`), espelhando `started_at`/`ends_at` nas colunas `subscriptions.trial_start`/`trial_end` que a Etapa 14 (ajuste arquitetural) já tinha deixado preparadas exatamente para isto. `trial_records` continua a única fonte de verdade das datas de trial — `tenant_access_status()` não foi tocado. Inclui backfill para tenants que já tinham `trial_records` sem `subscriptions`.

## Limites reais

### Valores (migration `20260817220064`)

| Plano | `products_limit` | `categories_limit` |
|---|---|---|
| BASIC | 50 | 10 |
| INTERMEDIATE | 500 | 50 |
| PRO | -1 (ilimitado) | -1 (ilimitado) |

`products_limit` já existia desde a Etapa 14 com valores diferentes (BASIC 100, INTERMEDIATE 1000) — o prompt desta etapa redefiniu os números explicitamente; a migration ajusta o valor corrente via `UPDATE`, sem editar a migration de seed original (histórico imutável).

### Enforcement atômico (migration `20260817220065`)

Trigger `BEFORE INSERT` em `products` e `categories`, não uma checagem na Server Action seguida de um INSERT separado (exatamente o anti-padrão que o prompt pede para evitar: "cria e depois verifica"). Dentro do mesmo trigger:

1. `pg_advisory_xact_lock(hashtext('<limit_key>:' || tenant_id))` — serializa inserts **concorrentes do mesmo tenant** para o mesmo recurso (lock liberado automaticamente no fim da transação). Tenants diferentes nunca esperam um pelo outro.
2. `private.plan_limit_value(tenant_id, limit_key)` — variante **interna**, sem a guarda de autorização de `tenant_plan_limit` (que existe porque aquela é uma RPC alcançável por `authenticated` com `tenant_id` arbitrário). Aqui não há esse risco: o único chamador é o próprio trigger, e `tenant_id` vem de `NEW`, nunca de um parâmetro exposto. Sem `GRANT EXECUTE` para `authenticated`/`anon` — inalcançável fora do trigger.
3. `NULL` → nega (SQLSTATE `VX010`, "sem plano/limite configurado" — fail-closed, nunca confundido com ilimitado). `-1` → permite (ilimitado). Caso contrário, `COUNT(*)` real na tabela; se `>= limite`, nega (`VX011`).

Testado explicitamente sob concorrência (`plan-enforcement.test.ts`): 5 inserts simultâneos disputando a última vaga de um limite de 10 → exatamente 1 sucesso, 4 falhas, contagem final nunca ultrapassa o limite.

### Server Actions (`features/products/actions.ts`, `features/categories/actions.ts`)

`createProductAction`/`createCategoryAction` seguem o checklist do prompt §9/§10: tenant via sessão → permissão (`has_permission`, inalterado) → `tenant_access_status` (rejeita se não `ACTIVE`/`TRIALING`) → INSERT (bloqueado pelo trigger se o limite foi atingido) → `VX011`/`VX010` traduzidos para mensagens claras ("Você atingiu o limite de produtos do seu plano atual. Faça upgrade..."). Nenhuma mudança de comportamento para quem está dentro do limite.

## Feature gating — primeiro retrofit real

`shipping` (frete) já era um recurso diferenciado por plano desde o seed da Etapa 14 (BASIC não inclui; INTERMEDIATE/PRO incluem) — e era a única funcionalidade do painel que já existia de verdade por trás de uma tela (não um `ComingSoon`). Por isso foi o alvo escolhido para o primeiro uso real de `FeatureGate`/`tenant_has_feature`, em vez de forçar isso em Clientes/Marketing/Relatórios/Vexo AI, que o prompt explicitamente pede para **não** implementar nesta etapa.

- `app/painel/configuracoes/entrega/page.tsx` — conteúdo (formulário + modalidades) envolvido em `<FeatureGate feature="shipping">`; mostra `UpgradeCta` para quem não tem o recurso.
- `features/shipping/actions.ts` — as 6 Server Actions do arquivo (settings, toggle, CRUD de modalidades) passam por `tenant_has_feature(tenant_id, 'shipping')` dentro de `resolveTenantAndPermission`, chamado de novo em toda Action — nunca confiando que o `FeatureGate` da página já bastou (prompt §5: "chamada direta à Server Action não pode burlar").
- `/painel/configuracoes` mostra um cadeado ao lado do link "Entrega" quando o plano não inclui.

### Sidebar (prompt §4)

`components/painel/nav-items.ts` ganhou um campo opcional `featureKey`. Só dois itens ganharam essa checagem, porque só eles têm uma `features.key` real correspondente no catálogo (prompt §16: "não inventar funcionalidades que ainda não existem"):

- **Clientes** → `customers`
- **Vexo AI Spark** → `vexo_ai`

**"Marketing" não ganhou checagem** — não existe uma feature `marketing` no catálogo da Etapa 14, e inventar uma só para preencher a tabela de exemplo do prompt violaria "não duplicar recursos / não inventar". O item continua exatamente como estava.

Itens bloqueados mostram um ícone de cadeado (`lock`) ao lado do rótulo — nunca escondidos (prompt §4: "preferir mostrar o recurso com estado bloqueado"). A fonte da verdade sobre o que está bloqueado é sempre o servidor: `app/painel/layout.tsx` chama `getTenantCommercialContext` uma vez por request e passa `unlockedFeatures: string[]` para o `Sidebar` (Client Component) — o componente cliente só desenha o cadeado, nunca decide o que está liberado.

`app/painel/clientes/page.tsx` foi ajustado para refletir isso: se o plano não inclui `customers`, mostra `UpgradeCta`; se inclui (recurso liberado, só ainda não construído), continua mostrando o `ComingSoon` de sempre. Nenhuma funcionalidade de clientes foi implementada.

## Camada de domínio (`features/commercial/tenant-plan.ts`)

`getTenantCommercialContext(tenantId)` — uma única função, `cache()` por request (mesmo padrão de `getCurrentMembership`), reunindo status/plano/features/limites do tenant a partir das mesmas fontes oficiais já existentes (`tenant_access_status`, `tenant_plan_limit`, o mesmo join `plan_features → features` que `tenant_has_feature` usa internamente). Não reimplementa nenhuma regra de autorização — só agrega o resultado para consumo pela UI. Usada por: `app/painel/layout.tsx` (sidebar), `/painel/configuracoes` (cadeado do link Entrega), `/painel/clientes` (UpgradeCta vs. ComingSoon), `/painel/produtos` e `/painel/categorias` (indicador de uso, abaixo).

## UX de limite (prompt §11)

`components/painel/plan-limit-indicator.tsx` — barra de progresso + contagem ("32 de 50 produtos do seu plano") nas páginas de Produtos e Categorias, usando a mesma contagem já exibida na lista (`products.length`/`categories.length`, sem query extra) contra o limite lido de `getTenantCommercialContext`. Quando o limite é atingido, mostra a mensagem de upgrade com link para `/painel/assinatura`. `limit === null` (não configurado) ou `-1` (ilimitado) não renderiza nada — puramente apresentação; a validação real continua no servidor.

## Testes existentes preservados

Descoberta durante a implementação: os triggers de limite passam a rodar em **todo** insert em `products`/`categories`, inclusive os que 4 arquivos de teste pré-existentes já faziam via `withSuperuser` para montar fixtures (`catalog.test.ts`, `cart.test.ts`, `checkout.test.ts`, `product-images.test.ts`) — nenhum desses tenants de fixture tinha `subscription`, então passariam a ser bloqueados (`NULL` → fail-closed) sem relação nenhuma com o que cada teste realmente verifica.

Corrigido com um helper novo, `giveUnlimitedPlan()` (`tests/integration/helpers/fixtures.ts`), que dá plano **PRO** (ilimitado nos dois `limit_key`s) para os tenants de fixture desses 4 arquivos — preservando o comportamento anterior a esta etapa exatamente como era. **Não** foi adicionado a `buildFixtures()` em si (usado por muitos outros arquivos, incluindo um teste em `commercial-foundation.test.ts` que depende explicitamente de `tenant_id` de `fx.tenantB` **não** ter uma subscription pré-existente para testar que o INSERT é negado por RLS, não por unique_violation) — mudar o fixture compartilhado teria quebrado esse teste.

## Testes novos (`tests/integration/plan-enforcement.test.ts`)

15 cenários, cobrindo integralmente o prompt §19: feature liberada/negada, usuário sem permissão não burla feature, BASIC/INTERMEDIATE/PRO nos dois limites (permitido no teto, negado 1 acima, ilimitado no PRO), isolamento entre tenants, concorrência (5 requisições simultâneas → exatamente 1 sucesso), e as duas mudanças pelo MASTER (remover feature / aumentar limite) refletindo imediatamente no tenant, sem alteração de código.

## Regressão encontrada e corrigida ao rodar a suíte completa (migration `20260817220066`)

Rodar `commercial-foundation.test.ts` (Etapa 14) contra as migrations desta etapa quebrou um teste pré-existente: `tenant_access_status` deixou de expirar trial nenhum. Causa raiz — `link_trial_to_subscription` (063) passou a criar, para TODO trial, uma `subscriptions` row com `status = 'trialing'`; como `tenant_access_status()` (055) sempre prioriza `subscriptions` sobre `trial_records` quando a linha existe, e o branch original `when 'trialing' then 'TRIALING'` não olhava data nenhuma, o resultado é que nenhum tenant em trial jamais passava a `EXPIRED`, mesmo com `trial_records.ends_at` no passado — regressão real de enforcement (trial infinito), não só teste desatualizado.

Corrigido em `20260817220066` (nova migration, `CREATE OR REPLACE` sobre a função de 055 — nunca editando a migration original): o branch `'trialing'` agora consulta `trial_records` diretamente (mesma checagem `status = 'active' and ends_at > now()` que o fallback já fazia) em vez de confiar em `subscriptions.trial_end`, que é só um espelho escrito uma única vez no INSERT e fica desatualizado se o trial for alterado depois. `trial_records` permanece a única fonte de verdade das datas, como documentado — a correção só faz a função de fato se comportar assim também quando existe uma subscription `trialing` (o caso normal a partir desta etapa), não só quando não existe nenhuma.

Também corrigidos, em `plan-enforcement.test.ts` (arquivo novo desta etapa, nunca commitado antes): (1) `bulkInsertProducts`/`bulkInsertCategories` usavam `$4`/`$5` só dentro de `generate_series($4, $4 + $5 - 1)`, sem nenhum contexto que resolvesse o tipo do parâmetro — Postgres rejeitava com `operator is not unique: unknown + unknown` (corrigido com `::int` explícito); (2) o teste de isolamento entre tenants reusava `tenantIntermediate`, que a essa altura da suíte já estava exatamente no teto de categorias (50/50) pelos testes anteriores — o insert "de controle" falhava por limite, não por falta de isolamento (corrigido usando um tenant dedicado, recém-criado); (3) o teste de concorrência chamava `asActor(...)` sem `{ commit: true }` — por padrão `asActor` faz ROLLBACK, então as 5 tentativas "concorrentes" nunca persistiam nada e nunca competiam de verdade pelo lock (cada uma via sempre a mesma contagem inicial); com `commit: true` a suíte de fato exercita `pg_advisory_xact_lock` sob concorrência real e confirma exatamente 1 sucesso / 4 negados.

## Decisões deliberadas / fora de escopo

- Nenhuma migration nova de tabela — só triggers/funções sobre o schema já existente da Etapa 14, mais duas linhas de seed (`categories_limit`) e um ajuste de valor (`products_limit`).
- Nenhuma feature nova inventada no catálogo — "Marketing" continua sem gate por não ter uma `features.key` correspondente.
- Clientes/Marketing/Relatórios/Vexo AI continuam sem nenhuma funcionalidade real — só a camada de "isso está bloqueado pelo plano ou não" foi ligada onde já existia uma feature real.
- Nenhuma cobrança, gateway de assinatura, ou alteração no Mercado Pago da Etapa 11.
- `NULL` de `tenant_plan_limit`/`plan_limit_value` (sem subscription ou limite não configurado) é tratado como **negado**, nunca como ilimitado — decisão deliberada de segurança (fail-closed), mesmo que isso signifique que um plano futuro sem `products_limit`/`categories_limit` configurado bloquearia criação até o MASTER configurar. Documentado explicitamente para quem for adicionar um plano novo.
