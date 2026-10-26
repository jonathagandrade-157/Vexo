# VEXO — prontidão de segurança em 2026-10-26

## Escopo e identidade

- Branch: `codex/vexo-security-hardening`
- Commit validado antes da reconciliação de histórico: `6a07c7791e4a4564166aae72aaa356a1281304bf`
- PR: `https://github.com/jonathagandrade-157/Vexo/pull/2`
- Supabase confirmado pela integração Vercel e pela CLI autenticada:
  projeto `Vexo`, ref `vqbiurnfqkjkrenigxzv`, região `us-east-1`, estado
  `ACTIVE_HEALTHY`.
- Nenhuma migration, DDL, DML, configuração Auth ou deploy de produção foi
  executado durante esta auditoria.

## Evidências automatizadas

- GitHub Actions `ci`: verde — audit, lint, typecheck, validação do rollout,
  51 arquivos/738 testes de integração PostgreSQL, 115 arquivos/1.314 testes
  unitários e build Next.js/Turbopack com 56 rotas.
- GitHub Actions `supabase-http`: verde — Auth, PostgREST e checkout contra
  stack Supabase isolada.
- GitHub Actions `e2e`: 6 cenários passaram; 4 storefronts foram pulados
  porque o job usa Supabase placeholder. A primeira tentativa expirou no
  download do Chromium; a repetição isolada passou em 2m23s.
- `npm audit`: 0 vulnerabilidades em produção e no conjunto completo.
- Preview Vercel `dpl_F51xaWWUjSimat8Gnhh1PGvCFp5z`: `Ready`; smoke
  autenticado de `/api/health`, `/` e `/loja/superbrands` retornou 200.

## Estado observado em produção — somente leitura

### Carrinho e checkout

- 13 carrinhos; 8 atualizados nos últimos 30 dias; 4 itens de carrinho.
- 7 pedidos `PENDING`; 0 pagamentos `PENDING`.
- `carts.owner_token_hash` e `carts.checkout_order_id` ainda não existem.
- `anon` ainda possui leitura direta de `carts`/`cart_items` e `EXECUTE`
  sobre `create_order_from_cart`, `apply_shipping_to_order` e
  `create_payment_for_order`. Este é o P0 que o rollout corrige.

### Histórico de migrations

- Produção registrou as migrations lógicas 63–118 com timestamps reais
  entre `20260824205848` e `20260910161209`; o repositório usava timestamps
  artificiais de 17/08.
- O SQL remoto foi buscado para uma pasta temporária e comparado com os 56
  arquivos locais: 51 semanticamente idênticos; quatro divergiam apenas em
  comentários/`;` do fetch; uma tinha, além do mesmo schema, um backfill
  pontual de endereço de uma loja que não pertence à migration versionada.
- Os arquivos locais foram renomeados para os timestamps reais, preservando
  o id lógico no nome. Nenhum `migration repair` remoto é necessário.
- O dry-run do repositório alinhado lista somente cinco migrations novas,
  `20261026210712`–`20261026210716`.
- O dry-run do lote de expansão, em diretório temporário sem a migration de
  contrato, lista exatamente `20261026210712`–`20261026210715`.

### Advisors Supabase

- Segurança: os acessos anônimos privilegiados do checkout confirmam o P0.
  O contrato revoga esses grants, fixa o `search_path` de
  `private.set_updated_at` e revoga a execução pública do event trigger
  hospedado `rls_auto_enable`.
- Exceções revisadas: `get_order_confirmation` permanece anon com UUID
  aleatório como capacidade e payload mínimo; as RPCs autenticadas de
  painel revalidam usuário, tenant e permissão dentro da função; vaults,
  rate-limit e elegibilidade sem policies são fail-closed por desenho.
- Auth: proteção contra senhas vazadas está desabilitada. Habilitar é P1 e
  exige mudança explícita na configuração hospedada.
- Performance: quatro policies recalculam `auth.*` por linha e `profiles`
  tem policies permissivas sobrepostas. Não bloqueiam o rollout P0, mas
  entram no backlog P1 de escala.
- Referências: [Database Linter](https://supabase.com/docs/guides/database/database-linter),
  [RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select) e
  [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### Recuperação

- `supabase backups list` retornou `backups: null` e `pitr_enabled: false`
  (`walg_enabled: true` não comprova um ponto restaurável disponível).
- Portanto, produção permanece **bloqueada para rollout** até existir e ser
  verificado um ponto de recuperação compatível com o plano atual, ou um
  procedimento de backup aprovado que não exponha dados pessoais.

## Sequência de liberação proposta

1. Criar/verificar recuperação e registrar baseline/commit/deployment.
2. Aplicar o lote de expansão `20261026210712`–`20261026210715` a partir
   do diretório de release sem o contrato; repetir dry-run e smoke.
3. Fazer merge/deploy do commit aprovado e testar carrinho, reload,
   quantidade, checkout idempotente, logs e health.
4. Aplicar somente `20261026210716` (lockdown), conferir privilégios e
   advisors, e repetir o smoke.
5. Manter a expansão se houver falha antes do contrato; promover o deploy
   anterior se houver falha da aplicação. Nunca apagar carrinhos/pedidos
   para recuperar o serviço.

Cada passo de produção depende de GO explícito; merge não é neutro porque
o Git Integration da Vercel publica `main` automaticamente.
