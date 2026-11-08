# VEXO — auditoria de segurança e concorrência (07/11/2026)

**Veredito: NO-GO mantido para beta com dados reais e operação comercial.**
As correções desta rodada estão em código e laboratório, **não em
produção**. Nenhum merge, migration de produção, deploy, revogação,
exportação, carga ou mutação de teste em produção foi executado.

## Estado conferido nesta rodada

| Item | Estado verificado em 07/11 |
| --- | --- |
| `main` | `da1ab1d4bcab1be78c332bd50b4305b9e3c887d5`, sem mudança |
| PR #3 | aberta, HEAD `9d0c670`; CI 42389337424: ci/e2e/recovery-lab verdes, navegador **101/108** (falhas: confirmação de pedido, convite de equipe, banners 360 px) |
| Esta entrega | PR #4 (rascunho), branch `claude/vexo-security-concurrency-audit-6grug6`, empilhada sobre a PR #3 |
| Produção Vercel | `dpl_AJnRSLMhKw959n5DtwtemJ52ZkJ1` (`da1ab1d`), domínio único `vexoecommerce.vercel.app` |
| Supabase produção | `vqbiurnfqkjkrenigxzv`, Postgres 17.6, última migration `20261026210716`; a migration da PR #3 e as três desta PR **não aplicadas** |
| Chaves Supabase | `anon` legada **ativa**; publishable moderna existe; Vercel Production/Preview ainda usam os nomes legados (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), compartilhados com Preview |

Ambientes usados: **Código** (revisão estática e build local),
**Laboratório** (Postgres 16 com as 127 migrations + CI com Supabase local
descartável: Auth, PostgREST, Storage, Mailpit), **Produção** (somente
leitura: SQL `SELECT`, advisors, metadados Vercel e GET anônimos isolados).
**Homologação não existe** — nenhum controle abaixo foi verificado em
homologação.

## Commits desta entrega

| SHA | Conteúdo |
| --- | --- |
| `e5583f5` | Confirmação de pedido exige prova assinada; RPC preparada para service_role-only; Sentry redige `?acesso=` e transações |
| `721ed9d` | Sete provas de concorrência com conexões PostgreSQL independentes |
| `ba83020` | PIX/endereço/dono das lojas deixam de ser legíveis por `anon`; DML anônimo removido |
| `8e19937` | Rate limit de login, cadastro, reenvio e recuperação |
| `fd6412d` | Dependabot (npm e GitHub Actions) |
| `ab32cb4` | E2E lê o ID do pedido pelo caminho e exige a prova no redirect |
| `9253637` | Privilégios mínimos do convite de equipe |

Migrations novas (todas **preparadas, não aplicadas**; aditivas ou de
restrição de privilégio, sem alterar dados/RLS/funções):

1. `20261107120000_order_confirmation_service_role_only.sql`
2. `20261107121000_anon_minimal_column_privileges.sql`
3. `20261107122000_team_invite_service_role_grants.sql`

O código funciona antes e depois delas (fallback explícito em
`getOrderConfirmation` só para `42501`; PIX/endereço já lidos com
service_role, que tem SELECT em `tenants` em produção).

## Prioridade 1 — confirmação de pedido apenas pela URL

**Antes:** o UUID do pedido era sozinho a credencial. Página e RPC
`get_order_confirmation` (SECURITY DEFINER, EXECUTE para `anon`) devolviam
nome, endereço e itens a quem tivesse a URL ou o par (loja, pedido) e a
chave pública. Produção confirma: advisor
`anon_security_definer_function_executable` para essa função.

**Correção (código):**

- Token `exp.HMAC-SHA256` sobre versão, finalidade, tenant, pedido e
  expiração (30 dias), chave derivada com contexto próprio de
  `TRIAL_HASH_SECRET` ou `ORDER_ACCESS_SECRET` opcional
  (`lib/security/order-access-token.ts`).
- Único construtor de links (`features/checkout/order-access.ts`) usado
  nos cinco emissores: redirect pós-checkout, redirect de replay, fluxo
  WhatsApp (novo e replay), `back_url` do Mercado Pago e e-mail.
- A página verifica antes de qualquer leitura; prova ausente, adulterada,
  de outra loja ou de outro pedido produz a mesma tela de "Pedido não
  encontrado", sem consulta. Prova legítima expirada mostra aviso próprio.
- Leitura por service_role; migration 1 move EXECUTE de `anon` para
  `service_role`.

**Evidência:** unitários de token (adulteração, expiração no limite,
troca de loja/pedido/chave, representação alternativa, malformados) e de
página (nenhuma chamada ao banco sem prova válida); integração PostgreSQL
(`anon`/`authenticated` sem EXECUTE); HTTP real com PostgREST local
(`anon`/`authenticated` negados, service_role lê, tenant errado → null) —
**17/17 no CI 42402645086**; navegador nas três larguras (estranho sem
cookie, prova adulterada, expiração estendida, troca de loja com prova
válida, link completo em outro contexto, recibo antigo após novo carrinho)
— a jornada antes vermelha **passou nas três larguras no CI 42402645086**.

**Limitações:** links já enviados sem token deixam de abrir a
confirmação (orientação na página); o token aparece em logs de requisição
da Vercel; quem recebe o link completo vê o pedido (é a credencial).
Produção continua exposta até deploy + migration 1.

## Concorrência (laboratório, conexões independentes)

`tests/integration/checkout-concurrency.test.ts` — cada ator em conexão
própria do pool; uma conexão extra segura a linha de estoque/pedido e o
teste espera, pela cadeia recursiva de `pg_blocking_pids`, até todas as
transações estarem realmente bloqueadas antes de liberar. 7/7 em três
execuções locais seguidas e no CI.

| Cenário | Resultado |
| --- | --- |
| 5 compradores na última unidade | 1 pedido, estoque 0, 4 recusas "insufficient stock", carrinhos perdedores intactos e sem `checkout_order_id` |
| Mesma variante disputada + variante irmã | estoque é por variante (não há pool compartilhado no modelo); 1 venda na disputada, a irmã vende normalmente |
| Carrinho com duas variantes, uma insuficiente | rollback total, inclusive da variante com estoque |
| Envio duplicado do mesmo carrinho | 1 pedido, `created=true` uma vez, 1 baixa |
| Reenvio após timeout (`statement_timeout`) | tentativa cancelada sem resíduo; reenvio cria 1 pedido; replays paralelos devolvem o mesmo pedido com `created=false` |
| Cancelamento simultâneo + repetido (simples e variante) | 1 sucesso, perdedor "changed concurrently"; repetição recusada; estoque devolvido exatamente uma vez |
| Cancelamento pendente × nova compra | compra recusada enquanto a devolução não confirma; depois, a unidade devolvida vende uma única vez |

Também passam: HTTP real (duplicidade e disputa via PostgREST) e
navegador (dois checkouts bloqueados na RPC e liberados juntos; duplo
clique e replay da Server Action). A proteção é atômica no banco
(`FOR UPDATE` do carrinho, `UPDATE ... WHERE stock_quantity >= qty`,
compare-and-swap de status), não o botão desabilitado.

**Risco de negócio observado:** só `update_order_status` devolve
estoque. Pedidos WhatsApp/externos não pagos mantêm a reserva até o
lojista cancelar; não há expiração automática (ver controle 12).

## Os 20 controles

Legenda de resultado: **Aprovado** (verificado no ambiente indicado),
**Corrigido (código)** (correção commitada e testada, produção pendente),
**Falha** (problema aberto), **Parcial**, **Não verificado**.

| # | Controle | Resultado | Ambiente | SHA | Evidência | Limitação | Correção pendente |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Chaves privadas só no servidor | Aprovado | Código + Produção (amostra) | `9253637` / prod `da1ab1d` | Build com valores-canário de 5 segredos: 0 ocorrências em `.next/static` e `.next/server`; 0 `.map` e 0 `sourceMappingURL` no cliente. Produção: 6 chunks da home sem `sourceMappingURL`, `.map` não servido, sem nomes de segredo nem JWT service_role | Amostra de 6 chunks; não inspecionados todos os bundles nem logs Vercel | `CRON_SECRET` está como *encrypted* com alerta `readable-secret` na Vercel: converter para *Sensitive* |
| 2 | Segredos no Git | Aprovado (repositório) / **Falha (credencial)** | Código + Produção | todas as branches, 160 commits | 14 padrões (Supabase legado/moderno, MP, Resend, Asaas, Sentry, GitHub, AWS, chave privada, URL Postgres): só fixtures sintéticas | Não cobre forks, logs/artefatos de CI antigos, chats | P0: JWT legados `anon`/`service_role` seguem ativos; substituir pelas chaves modernas já emitidas, publicar e revogar com prova de 401 (runbook `supabase-key-rotation.md`) — requer aprovação |
| 3 | Públicas × privilegiadas | Aprovado (código) | Código + Produção (nomes) | `9253637` | Só URL e anon/publishable em `NEXT_PUBLIC_*`; `lib/env.ts` prefere nomes modernos; secret nunca com prefixo público | A chave pública é pública: a proteção real é RLS/grants — por isso controles 4 e 17 | Configurar nomes modernos na Vercel |
| 4 | RLS, grants, funções, Storage | Corrigido (código) / Falha em produção | Laboratório + Produção | `ba83020`, `e5583f5`, `9253637` | Produção: RLS+FORCE em todas as tabelas com grant `anon`, policies `anon` só SELECT, view `security_invoker`, Storage por pasta do tenant + permissão; 79 funções DEFINER com `search_path` fixo (lab) | Lab Postgres concede tudo a service_role; produção é restritiva — integrações não detectam privilégio faltante (só o E2E com Supabase local) | Aplicar migrations 1–3 após GO; P2: `create_billing_invoice`/`set_billing_gateway_identifiers` executáveis por `authenticated` com valores do cliente |
| 5 | Criptografia | Parcial | Produção + Código | `9253637` | HTTPS com HSTS preload; Postgres `ssl=on`, `scram-sha-256`; CPF como HMAC; cookie de cadastro AES-256-GCM; credenciais de gateway no Supabase Vault | Cifra em repouso do disco/backup é do provedor — **não verificada**; `TRIAL_HASH_SECRET` é raiz de várias chaves derivadas (CPF, cookie, token de pedido, contador) e não tem rotação documentada | Documentar custódia/rotação; usar `ORDER_ACCESS_SECRET` dedicado |
| 6 | Autenticação no servidor | Aprovado | Código + Lab | `9253637` | Servidor usa `auth.getUser()` (nenhum `getSession` no servidor); proxy renova sessão; JWT inválido/expirado → 401 no HTTP real | Sem MFA | — |
| 7 | Autorização por operação/papel/loja/recurso | Corrigido (código) / Falha em produção | Lab + CI | `9253637` | Matriz de 5 papéis no navegador (PR #3); RPCs revalidam membro/permissão; confirmação de pedido agora exige prova | Convite de equipe quebrado em produção por falta de grants (reproduzido no CI) | Migration 3 |
| 8 | Mass assignment | Parcial | Código | `9253637` | Zod com allowlist nas Actions; tenant sempre do servidor; preço/frete/estoque recalculados no banco | Revisão por amostragem, não campo a campo | P2: RPCs de billing aceitam `p_amount`, `gateway_*_id` do chamador autenticado (sem UI hoje); mover para service_role com valores calculados no servidor |
| 9 | Cookies, sessão, CSRF, CORS | Aprovado (código) / Parcial (produção) | Código + Produção | `9253637` | Carrinho HttpOnly/SameSite=Lax/Secure com hash; Server Actions com checagem de origem nativa do Next; webhooks com assinatura/token; cron Bearer; OAuth com state HMAC + cookie + PKCE; produção sem `Access-Control-Allow-*` | Cookies de sessão do `@supabase/ssr` são legíveis por JS (padrão); com CSP só report-only, XSS exporia sessão; domínios customizados não testados (nenhum ativo) | Ver controle 18 |
| 10 | Senhas e provedor | **Falha (config. produção)** | Produção (advisor) + Código | — | Hash pelo Supabase Auth; mínimo 8 caracteres no servidor | Advisor: proteção contra senhas vazadas **desligada**; confirmação de e-mail desligada (registro de 05/11, não reconsultado) | Habilitar senhas vazadas, confirmação de e-mail e política mínima no painel Supabase — requer aprovação |
| 11 | Rate limit compartilhado | Corrigido (código) | Código + Lab | `8e19937` | Contador Postgres entre instâncias; IP via `x-forwarded-for` reescrito pela Vercel; agora também login/cadastro/reenvio/recuperação por IP e HMAC de e-mail; falha: login aberto, demais fechados; checkout aberto; frete fechado | Limite por e-mail permite bloqueio temporário de uma conta por terceiros (10/10 min, aceito); API direta do Supabase Auth usa só os limites do provedor (config. não verificada); laboratório E2E dispensado por guarda tripla | Conferir limites do Supabase Auth no painel |
| 12 | Proteção contra robôs | **Falha** | Código | — | Nenhum CAPTCHA/desafio. Checkout só via BFF (RPCs service_role) + 5/min por IP+loja | Cadastro pela API direta do Supabase Auth contorna o app; robôs distribuídos podem reservar estoque com pedidos WhatsApp não pagos | Decisão: CAPTCHA no Supabase Auth (cobre API direta) + no checkout; e expiração de reservas não pagas. Turnstile é gratuito mas exige conta Cloudflare — **não adicionado** |
| 13 | Consultas parametrizadas / SQL dinâmico | Aprovado | Código + Lab | `9253637` | supabase-js/PostgREST parametrizados; SQL dinâmico só `format(%I)` com nomes de catálogo; busca do master remove `,()` e escapa curingas; DEFINER com `search_path=''` | — | — |
| 14 | Validação no servidor | Aprovado (amostra) | Código + Lab | `9253637` | Zod (tamanho/formato), CHECK no banco (CEP, UF, valores ≥ 0), regras de checkout no banco | Não auditado campo a campo | — |
| 15 | Vazamento em erros/logs/URLs/cache/observabilidade | Corrigido (código) | Código + Produção | `e5583f5` | Mensagens genéricas; logs só com códigos; Sentry redige `?acesso=`/`token`/`code`/`state` em URL e passa a limpar transações (antes ignoradas); `/pedido/` fora do robots; produção `Cache-Control: private, no-store`; `/api/health` = `{"status":"ok"}` | Token de pedido presente em logs de acesso da Vercel | — |
| 16 | Uploads | Parcial | Produção + Código | `9253637` | Policies por pasta do tenant + permissão; 5 MB; allowlist JPEG/PNG/WebP (sem SVG); logo/banner verificados por bytes reais no servidor; bucket em origem separada; otimizador do Next valida imagem | Imagens de produto: o sniff usa bytes enviados pelo navegador e o arquivo real não é verificado; sem reprocessamento — EXIF/GPS preservados | P3: reprocessar/limpar metadados; verificar bytes reais |
| 17 | Respostas mínimas | Corrigido (código) / Falha em produção | Produção + Lab | `ba83020` | Produção: `anon` lia `pix_key`, titular, endereço, `created_by` de toda loja não suspensa (5 visíveis, 1 com PIX, 1 com endereço — contagem sem ler valores) e hash de verificação de domínio | `product_inventory.stock_quantity`/`low_stock_threshold` exatos continuam públicos (usados pela vitrine) | Migration 2; P3: expor só disponibilidade |
| 18 | Cabeçalhos e CSP | Parcial | Produção | prod `da1ab1d` | HSTS `max-age=63072000; includeSubDomains; preload`, nosniff, `X-Frame-Options: SAMEORIGIN`, Referrer-Policy, Permissions-Policy, sem `X-Powered-By` | CSP só **report-only**, com `unsafe-inline` e sem destino de relatório | Decisão: CSP com nonce exige renderização dinâmica |
| 19 | HTTPS, redirecionamentos, domínios | Aprovado (parcial) | Produção | prod `da1ab1d` | Domínio único; URLs de deployment, alias do time, branch `main` e Preview da PR #3 — inclusive `/api/*` — redirecionam anônimos ao SSO da Vercel | Redirecionamento HTTP→HTTPS não verificado (proxy do executor só HTTPS); Previews usam credenciais de produção | Separar credenciais de Preview |
| 20 | Dependências e CI | Aprovado | Código + CI | `fd6412d` | `npm audit` 0 (todas as dependências); lockfile versionado; `npm ci`; audit no CI; Dependabot adicionado | Actions por tag de versão (exceto Supabase CLI por SHA); sem varredura de segredos no CI | P3: fixar Actions por SHA |

## Testes executados

| Suíte | Ambiente | Resultado |
| --- | --- | --- |
| Unitários | local | 1.398/1.398 |
| PostgreSQL (127 migrations) | local | 747/747 (inclui 7 de concorrência e novos de privilégio) |
| Rollout das migrations de carrinho | local | aprovado |
| Typecheck, lint, build de produção | local | aprovados |
| HTTP real Auth/PostgREST | CI 42402645086 | 17/17 |
| Navegador (desktop, Pixel 7, 360 px) | CI 42402645086 | confirmação de pedido aprovada nas três larguras; falharam o convite (corrigido em `9253637`, aguarda CI) e a leitura do ID no teste de comércio (corrigido em `ab32cb4`) |

O resultado do CI do HEAD final está na PR #4. CI verde não torna o
projeto pronto: as correções só valem em produção após deploy e
migrations aprovados.

## Riscos restantes (ordem de prioridade)

1. **P0** — JWT legados (`anon`, `service_role`) ativos e compartilhados
   com Preview; revogação não executada.
2. **P0** — backup/restore real não comprovado (ver relatório geral).
3. **P1** — produção continua expondo a confirmação de pedido via RPC
   pública e PIX/endereço/dono via `anon` até deploy + migrations 1 e 2.
4. **P1** — sem proteção anti-robô; reservas de estoque sem expiração.
5. **P1** — senhas vazadas e confirmação de e-mail desligadas no Supabase
   Auth de produção.
6. **P1** — convite de equipe quebrado em produção (migration 3).
7. **P2** — RPCs de billing aceitam valores financeiros do cliente; CSP
   não aplicada; Previews com credenciais de produção.
8. **P3** — bytes reais/EXIF de imagens de produto, estoque exato público,
   Actions sem SHA, `CRON_SECRET` legível.

## Próximo passo concreto

Revisar e mesclar a PR #4 na PR #3; com o GO específico já exigido para
release: (1) configurar `SUPABASE_SECRET_KEY` e
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` na Vercel, separando Preview;
(2) publicar o código; (3) aplicar a migration da PR #3 e as migrations
1–3 desta PR; (4) smoke de confirmação de pedido, vitrine, checkout e
convite; (5) revogar os JWT legados e comprovar 401. Em paralelo, decidir
CAPTCHA e expiração de reservas, e habilitar as proteções de senha do
Supabase Auth.
