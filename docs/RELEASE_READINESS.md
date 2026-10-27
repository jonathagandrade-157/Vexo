# VEXO — Release Readiness

Atualizado em 2026-10-27. Este checklist registra o estado executável do
lançamento. Um item só recebe `[x]` quando existe evidência do ambiente
correto; histórico de CI não aprova alterações locais posteriores.

## Identidade da entrega

- Repositório: `jonathagandrade-157/Vexo`.
- Worktree ativo: `.worktrees/vexo-security-hardening`.
- Branch: `codex/vexo-launch-blockers`.
- Base do hotfix: `d0456e5aea3f3b71bc6cf5f9abfe61d9a74b7a69`.
- PR anterior: `#2`, mesclado em `da1ab1d4bcab1be78c332bd50b4305b9e3c887d5`.
- PR atual: `#3`, aberto contra `main`; nenhum merge/deploy autorizado.
- Produção: `https://vexoecommerce.vercel.app`.
- Supabase: projeto `Vexo`, ref `vqbiurnfqkjkrenigxzv`, região `us-east-1`.
- O checkout principal está isolado do worktree principal, que contém
  alterações não relacionadas e não será modificado por esta missão.

## Estado atual por prioridade

### P0 — bloqueia lançamento

- [ ] Substituir a chave legada privilegiada potencialmente exposta por
  `SUPABASE_SECRET_KEY`, validar todos os consumidores e desativar as
  chaves legadas.
- [ ] Comprovar um backup recuperável e um restore em ambiente isolado.
- [x] Remover acesso direto de `anon`/`authenticated` a `carts`,
  `cart_items` e RPCs privilegiadas. Evidência: migrations
  `20261026210715` e `20261026210716` registradas em produção no rollout
  de 2026-10-26; a leitura anônima direta passou a receber acesso negado.
- [x] Proteger a posse do carrinho com segredo aleatório em cookie
  `HttpOnly`/`Secure`/`SameSite=Lax`, persistindo somente SHA-256.
- [x] Tornar o checkout transacional e idempotente por carrinho por meio
  de `checkout_cart_secure`.

### P1 — impede operação comercial

- [ ] Corrigir o carrinho que confirma a inclusão, mas abre vazio em
  produção. Reproduzido em IAB, Chrome e Playwright; o cookie seguro é
  emitido. Correção do cliente administrativo preparada, ainda não
  validada nem publicada.
- [ ] Validar adição, múltiplos itens, quantidade, remoção, reload,
  navegação, estoque, indisponibilidade, isolamento e manipulação de
  identidade em um ambiente controlado.
- [ ] Validar checkout, pedido e estoque ponta a ponta após corrigir o
  carrinho.
- [ ] Publicar a correção do cron que evita inicializar o Mercado Pago
  quando não há pagamentos pendentes.
- [ ] Validar Mercado Pago em sandbox: OAuth, PIX, cartão, webhook,
  duplicidade, falha, cancelamento/reembolso e reconciliação.
- [ ] Validar Asaas em sandbox: assinatura, webhook, renovação,
  inadimplência, troca de plano, cancelamento e reativação.
- [ ] Completar cadastro, confirmação, login, onboarding, publicação e
  gestão de pedidos do lojista no navegador.

### P2 — qualidade necessária

- [ ] Completar smoke autenticado do painel em desktop, 360 px e Pixel 7.
- [ ] Completar jornada do comprador em desktop, 360 px e Pixel 7.
- [ ] Confirmar console, erros HTTP, hidratação, teclado, foco, loading,
  estados vazios e indisponibilidade.
- [ ] Configurar alertas de checkout, webhook, cron e reconciliação.
- [ ] Validar rate limits, timeouts e retries dos gateways.
- [ ] Revisar CSP para evolução controlada de report-only para enforcement.

### P3 — fora desta missão

- Novos módulos, redesenho visual e expansões sem impacto no lançamento.

## Alterações locais em validação

- Compatibilidade zero-downtime com
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`, mantendo
  fallback legado temporário.
- Cliente administrativo alterado de `@supabase/ssr` para
  `@supabase/supabase-js`, sem persistência, refresh ou detecção de URL.
- Erros de autorização/leitura do carrinho deixam de virar carrinho vazio
  silenciosamente e passam a gerar exceção sanitizada no Sentry.
- Cron de reconciliação retorna sucesso sem instanciar gateway quando não
  há pagamentos vencidos.
- Regressão E2E verifica presença, atributos e formato do cookie de posse.
- Testes unitários novos cobrem chaves modernas, precedência e erro de
  consulta do carrinho.
- O diagnóstico temporário que escrevia carrinho em produção foi removido;
  nenhum teste permanente depende de mutação do ambiente publicado.

## Evidências válidas

- PR #2 / commit `d0456e5`: CI verde com `npm audit`, lint, typecheck,
  validação de rollout, 738 integrações PostgreSQL, 1.314 unitários,
  build Next.js e testes HTTP isolados de Auth/PostgREST/checkout.
- Deploy de produção informado: `dpl_AJnRSLMhKw959n5DtwtemJ52ZkJ1`,
  `READY`, com alias público.
- Smoke de produção: home, storefront e produto respondem; banner passou
  a apontar para `/loja/superbrands#produtos`; a hidratação React `#418`
  não reapareceu nos cenários repetidos.
- Falha atual do carrinho é uma evidência negativa válida e mantém o gate
  fechado.
- Em 2026-10-27, `supabase migration list --project-ref` confirmou todas
  as versões locais e remotas alinhadas até `20261026210716`, sem migration
  pendente ou divergente.

## Evidências inválidas ou pendentes

- O `EPERM` inicial do Vitest foi isolado ao diretório temporário do
  sandbox. Com `TEMP`/`TMP` dentro do worktree, 60/60 testes focados e
  1.322/1.322 testes unitários passaram.
- O build Turbopack local continua pendente: três execuções falharam ao
  criar o worker que lê `instrumentation.ts`/`instrumentation-client.ts`,
  inclusive fora do sandbox e com temporário no worktree. O build Webpack
  diagnóstico passou da inicialização/compilação sem reproduzir o erro,
  mas foi encerrado depois de ficar sem progresso observável. Nenhum dos
  dois resultados conta como build aprovado; o CI Turbopack permanece gate.
- O smoke Playwright local também permanece pendente. Fora do sandbox,
  três cenários públicos passaram antes de o Turbopack entrar em panic ao
  observar o arquivo `LOCK` do perfil temporário do Chromium. Uma segunda
  execução isolada com Webpack ficou presa na compilação inicial da landing
  no worktree do OneDrive e foi encerrada. Nenhuma execução parcial é
  registrada como E2E aprovado; o job Linux do CI continua sendo a prova.
- Não há evidência de restore. A verificação read-only foi repetida em
  2026-10-27 com Supabase CLI 2.115.0 e confirmou `backups: null`,
  `pitr_enabled: false`, `physical_backup_data: {}` e `walg_enabled: true`;
  WAL habilitado não é um ponto restaurável disponível para o projeto.
- Não há credenciais de sandbox configuradas e validadas para Mercado
  Pago/Asaas neste worktree.
- O fluxo manual completo de lojista e comprador ainda não foi executado
  após o deployment atual.

## Gates de release

- [x] Testes unitários atuais: 115 arquivos / 1.322 testes.
- [ ] Testes de integração atuais.
- [ ] E2E desktop e mobile atuais.
- [x] Typecheck.
- [x] Lint.
- [ ] Build de produção.
- [x] `npm audit --audit-level=moderate`: 0 vulnerabilidades.
- [ ] Histórico/dry-run de migrations sem divergência.
- [ ] Smoke de homologação.
- [ ] Backup e restore comprovados.
- [ ] Monitoramento e rollback revisados.
- [ ] PR revisável e CI verde.
- [ ] Aprovação explícita para deployment de produção.
- [ ] Smoke pós-deploy e logs limpos.

## Bloqueios externos

| Bloqueio | Responsável | Ação necessária |
| --- | --- | --- |
| Backup/PITR indisponível | Proprietário do projeto | Contratar recurso ou aprovar/configurar backup lógico protegido e destino separado. |
| Rotação real de credenciais | Proprietário + operação | Autorizar a troca depois do smoke com as chaves modernas; nunca copiar valores para relatório. |
| Mercado Pago sandbox | Proprietário | Fornecer/configurar app, webhook e usuários de teste no ambiente seguro. |
| Asaas sandbox | Proprietário | Fornecer/configurar API key e token de webhook no ambiente seguro. |
| Produção | Proprietário | Dar GO específico somente após os gates anteriores. |

## Próxima tarefa executável

1. Ampliar as regressões permanentes do cliente administrativo e do carrinho.
2. Executar integração segura do carrinho em ambiente controlado.
3. Executar typecheck, lint, build, auditoria e suíte aplicável.
4. Criar commit e PR; não publicar em produção sem novo GO explícito.

## Veredito

**NO-GO comercial.** O código possui proteções relevantes e baseline forte,
mas carrinho, rotação de credencial e recuperação de dados continuam gates
obrigatórios sem evidência de conclusão.
