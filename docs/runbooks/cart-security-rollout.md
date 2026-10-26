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

## Fase 1 — expand

Aplicar somente `20260817220122_cart_ownership_expand.sql`. Ela adiciona
colunas, trigger e `checkout_cart_secure`, mantendo temporariamente os
grants legados para a aplicação antiga. Validar:

- `owner_token_hash` e `checkout_order_id` existem;
- `checkout_cart_secure` é executável por `service_role`, nunca por
  `PUBLIC`, `anon` ou `authenticated`;
- storefront atual continua respondendo.

Como a CLI não oferece um seletor `--to`, não executar `db push` com as
duas migrations pendentes nesta fase. Usar o procedimento administrativo
aprovado para aplicar um único arquivo e registrar a versão
`20260817220122` no histórico. Fazer `db push --dry-run` antes e depois.

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

Aplicar `20260817220123_cart_checkout_lockdown.sql`. Ela remove policies,
privilégios de tabela e `EXECUTE` públicos. Verificar com
`has_table_privilege` e `has_function_privilege` que anon/authenticated
não conseguem listar ou alterar carrinhos nem executar `add_to_cart`,
`create_order_from_cart` ou `checkout_cart_secure`. Repetir o smoke de
carrinho/checkout pelo app, que deve continuar funcionando via BFF.

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
