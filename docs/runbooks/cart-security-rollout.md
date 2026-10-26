# Rollout de segurança do carrinho

Este runbook cobre a mudança expand/deploy/contract que remove o acesso
anônimo direto a carrinhos e checkout. Ele não autoriza execução em
produção: aplicar migrations ou promover deploy exige um **GO específico**.

## Pré-condições

- Confirmar por nome, organização, URL e project ref que o Supabase é o
  projeto do VEXO. O repositório local não está vinculado de forma
  confiável; nunca usar o primeiro projeto listado pela conta.
- Confirmar backup recente e um caminho de conexão administrativa.
- CI verde, incluindo integração Postgres, testes HTTP PostgREST,
  `npm audit`, lint, typecheck, unitários, E2E e build.
- Registrar quantidade de carrinhos ativos, pedidos pendentes, commit e
  deployment atual antes da mudança.
- Confirmar que `supabase migration list --linked` alinha todas as versões
  até `20260910161209` e que o dry-run lista somente as cinco migrations
  `20261026210712` a `20261026210716`. Nunca usar `migration repair` neste
  rollout: os arquivos do repositório já carregam os timestamps reais do
  histórico hospedado.

## Fase 1 — expand

Aplicar o lote compatível com a aplicação atual, parando antes do
lockdown:

1. `20261026210712_20260817220119_subscription_past_due_grace_period.sql`;
2. `20261026210713_20260817220120_reconcile_stale_pending_payments.sql`;
3. `20261026210714_20260817220121_apply_payment_update_approved_sticky.sql`;
4. `20261026210715_20260817220122_cart_ownership_expand.sql`.

As três primeiras migrations são compatíveis e independentes do carrinho;
a quarta adiciona colunas, trigger e `checkout_cart_secure`, mantendo
temporariamente os grants legados para a aplicação antiga. Validar:

- `owner_token_hash` e `checkout_order_id` existem;
- `checkout_cart_secure` é executável por `service_role`, nunca por
  `PUBLIC`, `anon` ou `authenticated`;
- storefront atual continua respondendo.

Como a CLI não oferece um seletor `--to`, não executar `db push` a partir
do diretório completo nesta fase. Montar um diretório temporário de release
com todas as migrations versionadas até `20261026210715`, executar
`db push --dry-run` nele e só então o `db push` aprovado. O histórico deve
registrar exatamente as versões `20261026210712`–`20261026210715`; o novo
dry-run no repositório completo deve deixar apenas `20261026210716`
pendente.

## Fase 2 — deploy da aplicação

Promover o commit aprovado e esperar o health check. Testar com dados
sintéticos:

1. abrir uma sessão nova e adicionar produto;
2. recarregar e alterar quantidade;
3. validar checkout até o ponto permitido;
4. repetir submissão e confirmar que o mesmo pedido é retornado;
5. confirmar ausência de erros inesperados no Sentry/Vercel.

Cookies legados contendo apenas UUID são abandonados de forma segura e
criam um carrinho novo; eles nunca recebem acesso retroativo.

## Fase 3 — contract

Aplicar `20261026210716_20260817220123_cart_checkout_lockdown.sql`. Ela remove policies,
privilégios de tabela e `EXECUTE` públicos, fixa o `search_path` de
`private.set_updated_at` e revoga a execução pública do event trigger
hospedado `rls_auto_enable`. Verificar com
`has_table_privilege` e `has_function_privilege` que anon/authenticated
não conseguem listar ou alterar carrinhos nem executar `add_to_cart`,
`create_order_from_cart` ou `checkout_cart_secure`. Repetir o smoke de
carrinho/checkout pelo app, que deve continuar funcionando via BFF.

Rodar os advisors novamente. Alertas de execução autenticada das RPCs de
painel permanecem exceções revisadas porque cada função revalida sessão,
tenant e permissão internamente. `get_order_confirmation` permanece anon
de propósito: o UUID aleatório do pedido é a capacidade de leitura e a
função retorna apenas a visão do cliente. Os avisos "RLS enabled no
policy" dos vaults/rate-limit/trial também são fail-closed intencionais.

## Recuperação

- Falha antes do deploy: manter apenas a expansão; a aplicação antiga
  continua compatível. Corrigir e repetir sem aplicar o contract.
- Falha do app depois do deploy e antes do contract: promover o deploy
  anterior; a expansão é aditiva e pode permanecer.
- Falha depois do contract: primeiro corrigir/promover o app seguro. Só
  reabrir grants legados mediante incidente aprovado, por tempo limitado
  e com o SQL inverso revisado; isso restaura a vulnerabilidade e não é
  rollback rotineiro.
- Nunca apagar `owner_token_hash`, `checkout_order_id`, pedidos ou itens
  para recuperar o serviço.

## Evidências a guardar

- project ref confirmado (sem secrets), timestamps e operador;
- saída redigida de dry-run e verificações de privilégios;
- commit, deployment, resultados dos smokes e observabilidade;
- horário de aplicação de cada fase e decisão de seguir/abortar.
