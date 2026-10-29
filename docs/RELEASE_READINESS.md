# VEXO — relatório de prontidão comercial

Atualizado em 2026-10-28. **NO-GO comercial.** A jornada de compra externa
já funciona no ambiente controlado. A correção do carrinho ainda precisa
ser aplicada em produção, e backup/restore, revogação da credencial
potencialmente exposta e integrações financeiras continuam bloqueadores.

## Entrega e ambientes

- PR candidata: [#3](https://github.com/jonathagandrade-157/Vexo/pull/3),
  branch `codex/vexo-launch-blockers`, worktree `.worktrees/vexo-security-hardening`.
- Revisão de código atual: `2c33600e32aea4dad28611b6d79906f583a0445c`.
- Código aprovado: [workflow 40802528351](https://github.com/jonathagandrade-157/Vexo/actions/runs/40802528351), commit `2c33600`, todos os jobs verdes.
- Produção: [VEXO](https://vexoecommerce.vercel.app), loja
  [SuperBrands](https://vexoecommerce.vercel.app/loja/superbrands).
- Último deploy de produção verificado anteriormente: PR #2, merge
  `da1ab1d4bcab1be78c332bd50b4305b9e3c887d5`, deployment
  `dpl_AJnRSLMhKw959n5DtwtemJ52ZkJ1`.
- Supabase: projeto `Vexo`, ref `vqbiurnfqkjkrenigxzv`, `us-east-1`.
- A PR #3 não foi mesclada nem publicada. Nenhuma alteração de banco,
  variável, credencial ou infraestrutura de produção foi feita nesta etapa.
- As alterações existentes no checkout principal foram preservadas.

## Correções candidatas e reprodução

Todas as linhas abaixo pertencem à PR #3, ainda sem rollout de produção.

| Defeito | Severidade | Como reproduzir / efeito | Correção e evidência |
| --- | --- | --- | --- |
| Carrinho aparece vazio após inclusão | P1 | Adicionar produto e abrir carrinho; cookie existe, mas a leitura falha. Consulta read-only em produção confirmou SELECT de service_role em products = false | Cliente administrativo usa supabase-js sem sessão SSR; migration mínima concede SELECT em products; join real e jornada de compra passam no Supabase descartável |
| Cron sem pendências inicializa gateway | P1 | Executar reconciliação sem pagamentos vencidos e sem configuração Mercado Pago | Retorno antecipado antes de instanciar gateway, coberto por regressão unitária |
| Ações de configurações exportam objeto | P1 | Submeter logout em configurações no build de produção; Next rejeita export de objeto em arquivo use server | Estado inicial movido para schema.ts; salvamento e logout reais aprovados nas três larguras |
| Hidratação de configurações | P2 | Login e abrir /painel/configuracoes; React #418 nas três larguras | Formulário de logout retirado de dentro do formulário de perfil; não reapareceu após a correção |
| Nome do produto some ou fica cortado no carrinho mobile | P2 | Abrir carrinho em Pixel 7/360 px | Grid responsivo, nome e variante com quebra de palavras; regressão mede largura e persistência |
| Link #promocoes não tem alvo | P2 | Abrir loja sem promoções nos cinco templates | Estado vazio legível com ID real e cinco regressões de renderização |
| Ícone entra no nome acessível do botão | P2 | Login inclui auto_awesome junto do texto do botão | Ícone decorativo aria-hidden; login real aprovado |
| Favicon de fallback ausente | P2 | Navegador solicita /favicon.ico durante cadastro/onboarding e recebe 404 | Arquivo ICO gerado da marca existente, com 16/32/48/256 px; regressão HTTP e assinatura do arquivo aprovadas |
| Carrinho perde contraste com tema claro do app | P2 | Abrir o carrinho com preferência clara; título claro fica sobre o fundo claro herdado do body | Shell da loja pinta o próprio fundo; regressão de contraste real do título e nome nas duas preferências aprovada, com capturas revisadas |

O antigo banner para `/loja/TESTE` e a hidratação da vitrine foram corrigidos
na PR #2. O erro #418 encontrado agora era outro, na página de configurações.

## Matriz executada

Os testes com mutações usam Auth, PostgREST e PostgreSQL reais em uma stack
Supabase descartável. O runner recusa endpoints fora de loopback e arquivos
.env locais/de produção, e remove credenciais de integrações externas.
Quatro produtos sintéticos cobrem produtos simples, variantes/promoção e
estoque zerado; não são cópias de dados pessoais de produção.

| Área | Validado no ambiente controlado | Limite ou pendência |
| --- | --- | --- |
| Carrinho | Dois produtos, quantidade, remoção, totais, reload e navegação; cookie HttpOnly/Secure/SameSite=Lax e token com hash no banco | Rollout e repetição em produção pendentes |
| Isolamento | Segredo alterado e cookie reaproveitado em outra loja não revelam itens; carrinho original permanece acessível ao dono | Matriz completa de papéis no navegador ainda pendente |
| Variantes e estoque | Seleção por teclado, variante ativa com promoção, bloqueio de variante sem estoque/inativa e produto simples sem estoque; variante/preço/quantidade persistem no carrinho | Checkout completo de variantes e mudanças concorrentes de estoque ainda precisam de E2E de navegador; integração PostgreSQL existente não substitui essa jornada |
| Checkout | Campos obrigatórios, foco no primeiro campo inválido, complemento opcional, criação em dinheiro e confirmação após reload | PIX/cartão e gateways reais não validados |
| Pedido | Pedido único no banco, baixa única de estoque, leitura no painel, confirmação manual sintética de pagamento, avanço para PREPARING e histórico; status não baixa estoque novamente | Todos os status, cancelamentos e filtros ainda sem cobertura completa de navegador |
| Painel | 17 rotas: HTTP 200, título visível e ausência de overflow/erros de console/hidratação; logout encerra a sessão e acesso posterior volta ao login | Leitura de página não valida todos os controles |
| Configurações | Nome vazio rejeitado sem alterar o banco; perfil/endereço persistem após reload; valores originais restaurados pela própria UI | Pagamentos, pedidos, entrega, domínio e plano ainda precisam de mutações completas |
| Cadastro e onboarding | Termos não aceitos e senhas diferentes não criam conta; cadastro cria OWNER e trial único, documento só como HMAC; retomada pelo banco, bloqueio de salto e publicação local; sem erro de console nas três larguras | Confirmação por e-mail não coberta: enable_confirmations=false na stack local |
| Catálogo e aparência | Home, detalhes de produto, âncoras, estados vazios, página/prévia de aparência e controles de tema | Gestão completa de produtos, categorias, banners, galeria e restauração das opções de aparência ainda pendentes |
| Equipe e histórico | Rotas de leitura e auditoria do pedido no banco local | Nenhum convite enviado; todos os papéis ainda sem jornada de navegador |
| Domínio e assinatura | Rotas carregam e bloqueios explícitos são respeitados | Nenhum domínio contratado, OAuth iniciado ou cobrança executada |
| Mobile | Desktop, Pixel 7 emulado e 360 px; texto do carrinho, overflow e teclado/foco nos cenários descritos | Aparelho físico, acessibilidade e estados de carregamento completos ainda pendentes |

Rotas do smoke: painel, pedidos, produtos, categorias, clientes, aparência,
equipe, histórico, configurações gerais/pedidos/pagamentos/entrega/domínio,
assinatura, suporte, marketing e VEXO AI. Módulos explicitamente bloqueados
ou “em breve” não são contados como implementados nem tratados como defeitos.

## Testes e evidências

- Baseline integralmente verde: commit `3f779a5`,
  [workflow 40563637511](https://github.com/jonathagandrade-157/Vexo/actions/runs/40563637511):
  1.327 unitários, 738 integrações PostgreSQL, 16 HTTP, 24 E2E, audit,
  lint, typecheck, rollout e build Linux/Turbopack.
- Commit `5765228`,
  [workflow 40799257440](https://github.com/jonathagandrade-157/Vexo/actions/runs/40799257440):
  30/33 E2E aprovados, incluindo as 17 rotas, logout e edição/restauração
  de configurações. O cadastro novo parou em seletor ambíguo de alerta;
  foi delimitado ao formulário sem alterar a aplicação.
- Commit `682aff8`,
  [workflow 40800515624](https://github.com/jonathagandrade-157/Vexo/actions/runs/40800515624):
  34/36 E2E aprovados. Variantes/promoção/indisponibilidade passaram nas
  três larguras; cadastro/onboarding/publicação chegaram ao fim, mas duas
  execuções registraram o 404 de /favicon.ico. URL exata foi capturada,
  sem filtrar o erro. Os jobs principal e público passaram.
- Revisão `fedcbf9`,
  [workflow 40801482456](https://github.com/jonathagandrade-157/Vexo/actions/runs/40801482456):
  todos os jobs verdes, 36/36 E2E, 16/16 HTTP, 1.327 unitários e 738
  integrações PostgreSQL; audit encontrou zero vulnerabilidades, lint,
  typecheck, rollout e build aprovados.
- [Nove capturas sintéticas](https://github.com/jonathagandrade-157/Vexo/actions/runs/40801482456/artifacts/12866551945)
  de configurações, carrinho com variante e loja publicada salvas por sete
  dias; cópia local em test-results/ci-fedcbf9, fora de Git. Todas foram
  inspecionadas. A revisão visual encontrou o contraste do título do
  carrinho, apesar do resultado funcional verde; correção em `2c33600`.
  A nova captura reposiciona a página no topo para que o cabeçalho fixo
  represente a posição inicial da tela.
- Revisão `2c33600`,
  [workflow 40802528351](https://github.com/jonathagandrade-157/Vexo/actions/runs/40802528351):
  todos os jobs verdes novamente, 36/36 E2E e 16/16 HTTP aprovados,
  incluindo contraste em preferências clara e escura. Código, testes e
  documentação não foram mesclados nem publicados em produção.
  [Novas capturas](https://github.com/jonathagandrade-157/Vexo/actions/runs/40802528351/artifacts/12867210819)
  em test-results/ci-2c33600; revisados carrinho desktop/360 px e
  configurações mobile. O título do carrinho está legível sobre o fundo
  correto. Barras fixas em capturas de página inteira representam a
  posição do viewport; não indicam que a barra ocupa aquele ponto do documento.
- A regressão de contraste usa as cores computadas pelo navegador e alvo
  conservador de 4,5:1 para o título e texto comum, em tema claro e escuro.
  Referência: [WCAG 2.2, contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
  Isso não equivale a uma auditoria integral de acessibilidade.
- Build/integrações Linux são a referência: as tentativas locais anteriores
  de Turbopack/Webpack no Windows/OneDrive ficaram parciais ou falharam na
  criação de workers/junctions. Não foram contabilizadas como aprovação.
- Preview protegido da PR: smoke read-only anterior em desktop e Pixel 7
  confirmou home, quatro produtos, carrinho/checkout vazios com HTTP 200,
  sem erro da aplicação ou link TESTE. Avisos CSP report-only da toolbar
  Vercel foram registrados separadamente; não demonstram CSP enforced.
- O smoke autenticado de produção permanece pendente: o controle de
  permissões do navegador recusou acesso. Nenhuma outra superfície foi
  usada para contornar essa recusa.

## Segurança e operação

Já aplicado em produção na PR #2: bloqueio de acesso direto anon/authenticated
a carts/cart_items e RPCs privilegiadas, cookie de posse com segredo aleatório
e hash SHA-256, checkout transacional e idempotente. Histórico de migrations
foi conferido alinhado até `20261026210716` antes do novo hotfix.

A PR #3 prioriza `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`,
com fallback legado temporário. Isso prepara a migração, mas não revoga a
credencial potencialmente exposta. O inventário read-only de produção de
2026-10-27 ainda encontrou apenas os nomes legados. Nenhum valor é incluído
neste relatório.

A nova migration `20261027150000_cart_product_read_grant.sql` ainda NÃO foi
aplicada em produção. Concede somente SELECT em products a service_role;
o teste de rollout reproduz a falta do grant antes de aplicar o hotfix
no banco descartável e confirma que anon/authenticated continuam bloqueados
no carrinho. Não alterar migrations antigas para resolver essa diferença.

A auditoria de dependências nos jobs aprovados encontrou zero vulnerabilidades
conhecidas no momento da execução. Esse resultado e os testes de isolamento
não constituem garantia de ausência de falhas em toda a plataforma. Permanecem
pendentes alertas operacionais, revisão de rollback, CSP enforced e validação
operacional dos limites, timeouts e retries dos provedores.

## Bloqueadores para vender

| Prioridade | Bloqueador | Ação necessária |
| --- | --- | --- |
| P0 | Credencial privilegiada potencialmente exposta | Validar consumidores com chaves modernas, autorizar substituição/revogação e comprovar que o acesso antigo deixou de funcionar |
| P0 | Backup e restore não comprovados | Usuário escolheu backup lógico externo; indicar destino protegido, controle de acesso e responsável; aprovar exportação concreta e demonstrar restore isolado, Storage e Vault |
| P1 | Carrinho e cron ainda sem correção publicada | Após backup e gates, aprovar migration mínima e deploy da PR revisada; repetir smoke e logs em produção |
| P1 | Mercado Pago não validado operacionalmente | Configurar sandbox seguro e testar OAuth, PIX/cartão, webhook, duplicidade, falhas, cancelamento/reembolso e reconciliação |
| P1 | Billing Asaas não validado | Configurar sandbox e testar assinatura, webhook, renovação, inadimplência, plano, cancelamento e reativação |
| P2 | Cobertura funcional restante | Concluir as jornadas e limitações explícitas da matriz, homologação com chaves modernas e aparelho físico |

Backups read-only em 2026-10-27: backups=null, pitr_enabled=false,
physical_backup_data vazio e walg_enabled=true. WAL habilitado não comprova
um ponto de recuperação disponível. Nenhum dump/export foi realizado.
Proposta de RPO 24 h, RTO 4 h e retenção 14 dias ainda não foi aprovada nem
medida; não deve virar compromisso comercial sem teste.

Inventário de nomes de variáveis em produção: entradas Mercado Pago e
OAUTH_STATE_SECRET existem, mas validade/modo não foram comprovados;
MERCADO_PAGO_TEST_MODE ausente; nomes Asaas ausentes. Resend, Sentry e
CRON_SECRET presentes. Presença do nome não comprova integração funcional.

Procedimentos preparados: [backup e recuperação](runbooks/backup-recovery.md)
e [rotação de chaves](runbooks/supabase-key-rotation.md). Serviços pagos,
exportação, revogação, migration e deploy exigem aprovação específica.

## Próximas ações

1. Completar as mutações e jornadas ainda pendentes na matriz, sem expandir
   módulos “em breve” e sem comunicação, OAuth ou transação real.
2. Receber o destino protegido e preparar a operação de backup para
   aprovação específica; executar e medir restore isolado.
3. Validar chaves modernas e sandboxes financeiros; somente então obter GO
   para migration/deploy, revogação e smoke de produção.
