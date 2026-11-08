# VEXO — relatório de prontidão comercial

Atualizado em 2026-11-08. **Sem liberação de produção, beta com dados reais
ou operação comercial.** Nenhum merge, migration de produção, deploy,
revogação, exportação real, carga ou mutação de teste em produção foi
executado nas rodadas abaixo.

## Auditoria de segurança e concorrência — 07–08/11

Relatório completo com os 20 controles (resultado, ambiente, SHA,
evidência, limitação, correção pendente):
[2026-11-07-security-concurrency-audit.md](reports/2026-11-07-security-concurrency-audit.md).
Entrega na PR #4 (rascunho), empilhada sobre a PR #3.

- **Confirmação de pedido pela URL — corrigido em código, aberto em
  produção.** Página e links legítimos agora exigem prova HMAC (tenant,
  pedido, expiração); prova ausente, adulterada, de outra loja ou de outro
  pedido não lê o banco. A regressão de isolamento que estava vermelha
  passou nas três larguras (CI 42402645086); RPC negada a anon/authenticated
  no PostgREST real. Produção segue expondo a RPC a `anon` até deploy +
  migration `20261107120000`.
- **Dados públicos excessivos — corrigido em código, aberto em produção.**
  Pela chave pública, `anon` lê PIX, titular, endereço e `created_by` de toda
  loja não suspensa (contagem somente leitura: 5 lojas, 1 com PIX, 1 com
  endereço). Migration `20261107121000` restringe colunas e remove DML anônimo.
- **Convite e gestão de equipe — causas confirmadas e corrigidas em código.** service_role de produção não tem
  SELECT em `roles` nem INSERT em `tenant_members`; o laboratório Postgres
  concede tudo e não detectava. Migration `20261107122000` concede o mínimo.
  Em produção `authenticated` também não tem UPDATE/DELETE em `tenant_members`
  (troca de função e remoção quebradas): migration `20261107123000`. O cliente
  PKCE também recusava o link implícito do convite (corrigido na página de senha).
  Jornada completa aprovada nas três larguras com Supabase local real.
- **Rate limit de Auth** (login, cadastro, reenvio, recuperação) adicionado,
  com política de falha explícita. **Sem proteção anti-robô**: decisão pendente.
- **Concorrência**: sete cenários com conexões independentes (última unidade,
  variantes, duplo envio, reenvio após timeout, cancelamento simultâneo e
  repetido, devolução única) aprovados no laboratório.
- **Produção conferida somente leitura**: HSTS preload e cabeçalhos ativos,
  CSP só report-only; URLs alternativas exigem SSO Vercel; nenhum `.map`
  servido; `anon` legada ativa e nomes legados na Vercel (Production e Preview);
  senhas vazadas desligadas no Supabase Auth.

HEAD `7cb977b`: [CI 42438272483](https://github.com/jonathagandrade-157/Vexo/actions/runs/42438272483)
totalmente verde (1.398 unitários, 748 PostgreSQL, 17 HTTP, 108/108 navegador,
audit zero, recovery-lab). Isso valida o laboratório, não a produção.
Quatro migrations novas aguardam o mesmo GO específico de release já exigido
para a migration da PR #3. "Não verificado" continua não aprovado;
homologação não existe.

## Revisão de 07/11 — execução atual

- Main remoto conferido em `da1ab1d4bcab1be78c332bd50b4305b9e3c887d5`;
  [PR #3](https://github.com/jonathagandrade-157/Vexo/pull/3) aberta e sem merge.
  Candidato funcional atual: `f53da035556f6197a50de785667bb564c34d4f49`.
  [CI 42387709919](https://github.com/jonathagandrade-157/Vexo/actions/runs/42387709919):
  ci (1.363 unitários, 738 PostgreSQL, audit zero, lint/typecheck/build e rollout),
  smoke público, recovery-lab e 16 HTTP aprovados. Navegador: **99/108 aprovados,
  nove falhas**, sem retries. Carrinho com JavaScript passou para visitante e
  lojista nas três larguras, com POST/quantidade=2 no banco e total persistente.
  O ajuste posterior de resposta ao formulário sem JavaScript, incluído neste
  documento/commit, ainda aguarda CI; não declarar o conjunto inteiro aprovado.
- Relato prioritário do proprietário: adicionar produto e encontrar carrinho vazio.
  A correção candidata já troca o cliente administrativo SSR por cliente sem
  sessão, trata erro de consulta explicitamente e inclui o SELECT mínimo de
  products para service_role. Está **na PR, não publicada em produção**.
  O último inventário do banco publicado (05/11, histórico abaixo) ainda
  não tinha esse grant; esta rodada não modifica esse banco.
- Novos commits cloud: `ffe97de` (Storage real no laboratório e regressões),
  `0493243` (controles do carrinho por formulário, tratamento de erro,
  pipeline de mídia isolado), `3e19f11` (IDs únicos nos banners e jornadas
  de equipe/pedidos) e `f53da03` (sincronização de navegação nos testes,
  controles de logo restritos à permissão e dimensões fixas dos botões).
- Documentação Next instalada foi lida nos logs do executor antes das mudanças
  de configuração. A permissão de imagens de loopback exige simultaneamente CI,
  marcador de laboratório e URL Supabase exatamente local. Quatro regressões
  verificam que produção/host remoto/marcador ausente não habilitam isso.

### Evidência executada e limites

| Jornada | Evidência confirmada nesta rodada | Limite atual |
| --- | --- | --- |
| Carrinho e catálogo existentes | As jornadas anteriores continuam exercitadas no browser contra banco descartável, incluindo recarga, variantes e tentativa de cookie entre lojas | Inclusão, ícone, quantidade e recarga aprovados em seis cenários de f53da03; sem publicação em produção |
| Galeria de produto | PNG/JPEG/WebP, persistência, ordem, principal, rejeição acima de 5 MB e remoção passaram nas três larguras em 0493243 e 3e19f11 | Falha/retry de transporte, limite de oito e ataque de escrita entre lojas ainda não completos |
| Logo | Troca nos três formatos, reload, remoção e campo nulo no banco passaram nas três larguras | Arquivos válidos entre 1 e 5 MB ainda precisam teste; não declarar todo limite homologado |
| Aparência | Cor/modelo persistidos, loja pública conferida e valores originais restaurados nas três larguras | Todos os modelos não foram auditados individualmente |
| Banners | Criação consecutiva, edição e ordenação chegaram ao banco; falha de fechamento e IDs repetidos foram reproduzidos e corrigidos | CRUD completo, ordem, status, remoção de registros e arquivos aprovados em f53da03 nas três larguras |
| Equipe | OWNER/ADMIN e negativas de escrita de outras funções exercitados; controle de logo indevido reproduzido para OPERATOR/SUPPORT e corrigido; matriz dos cinco papéis aprovada nas três larguras em f53da03 | Convite/aceite integral ainda falhou; diagnóstico novo não envia mensagens externas |
| Pedidos | Filtros, confirmação manual sintética, rejeição de salto de status, evolução até DELIVERED, histórico e estoque passaram em 3e19f11 nas três larguras | Cancelamento devolveu estoque uma vez, inclusive com replay, nas três larguras em f53da03; esta revisão reforça as assertivas antes/depois |
| Comprador | Mudança de preço/indisponibilidade e duplo envio/replay sem duplicar pedido/baixa passaram nas três larguras | Última unidade passou nas três larguras com dois checkouts bloqueados na entrada da RPC e liberados juntos; isolamento da confirmação continua falhando |
| E-mail/Auth | Confirmação, expiração/reuso, reenvio, recuperação e retomada seguem no laboratório Mailpit | Não comprova SMTP/entregabilidade hospedada |
| Recuperação | Recovery-lab sintético aprovado novamente | Nenhuma exportação/restore de dados reais nem B2 homologado |

- [CI 42385977507](https://github.com/jonathagandrade-157/Vexo/actions/runs/42385977507),
  SHA `3e19f11`: **75/108 E2E aprovados e 33 falhas**, sem retries.
  Esse total não representa 33 defeitos de produto: inclui seletor encontrando
  option oculta, pressuposto incorreto sobre botão desabilitado do MANAGER,
  regra antiga de cancelamento e recarga antes da navegação do Link terminar.
  As falhas continuam registradas; os testes foram ajustados ao contrato real
  sem filtrar console ou enfraquecer as verificações de persistência.
- A captura/DOM da falha do carrinho mostrou a **página do produto**, não a
  página do carrinho: o teste clicava no Link e recarregava antes de aguardar
  a mudança de URL. O teste atual exige URL e título do carrinho, envio da
  alteração, quantidade no banco e total após recarga.
- O ci desse SHA teve 737/738 integrações aprovadas: a falha foi colisão
  aleatória na geração do número de pedido da fixture de pagamentos.
  A fixture agora usa UUID; a integração do SHA f53da03 passou inteira.
- [CI 42384579072](https://github.com/jonathagandrade-157/Vexo/actions/runs/42384579072),
  SHA `0493243`: 66/81 E2E; ci, smoke e recovery-lab aprovados. Mantido
  como evidência intermediária, não como validação final.
- [Artefato sintético de 3e19f11](https://github.com/jonathagandrade-157/Vexo/actions/runs/42385977507/artifacts/13579848567),
  confirmado pelo SHA do run e disponível até 14/11. Evidências PNG sintéticas estão nos artefatos desses runs. Foram revisadas
  visualmente capturas 360 px de confirmação de variante, aparência pública e
  logo. A captura de viewport da galeria não enquadrava as imagens; o teste atual
  passa a rolar até o título da mídia antes de capturar. [Artefato de f53da03](https://github.com/jonathagandrade-157/Vexo/actions/runs/42387709919/artifacts/13580791741),
  SHA conferido e disponível até 14/11. Carrinho visitante/autenticado 360 px
  revisado visualmente: quantidade, total e controles legíveis, sem sobreposição.
  Emulação não é aparelho físico.

### Pendências novas reproduzidas

- **P1 — confirmação sem prova adicional de posse:** no laboratório, outro
  contexto sem cookies abre a confirmação ao conhecer a URL do pedido e vê
  nome/endereço e itens. O UUID é não sequencial, mas atua sozinho como
  credencial. A função pública get_order_confirmation(uuid,uuid) mantém esse
  contrato. A regressão de isolamento permanece vermelha. Preparar mudança
  de privilégios na PR depende da resposta já solicitada sobre a exceção à
  proibição de novas migrations; nenhuma foi criada/aplicada. A correção precisa
  cobrir página, RPC e links legítimos, sem bloquear o próprio comprador após
  abrir um novo carrinho. Proposta técnica: prova assinada com tenant/pedido/
  expiração nos redirects e e-mails, verificação no servidor e leitura da RPC
  administrativa; testar também troca de loja, adulteração, expiração, acesso
  direto à RPC e recibo antigo após criar novo carrinho.
- **P2 — logo exibindo mutadores a funções sem settings.update:** reproduzido
  no browser; servidor já recusava a operação. O controle agora acompanha canEdit;
  matriz de permissões aprovada em f53da03.
- **P2 — banners:** criar um segundo banner deixava diálogo aberto porque
  o efeito observava apenas status=success; vários diálogos também repetiam IDs.
  Corrigidos observando o novo resultado da ação e usando useId.
- **P1/P2 — convite integral local bloqueado:** falhou nas três larguras.
  O catálogo real do laboratório confirmou ausência de INSERT de service_role
  em tenant_members. A inspeção de migrations também mostra SELECT de roles
  somente para authenticated, enquanto a ação de convite consulta esse catálogo
  com service_role; falta confirmar a mensagem de erro delimitada ao main.
  Não habilitar INSERT de authenticated: a ausência de policy é intencional.
  A correção completa precisa de privilégios mínimos via migration revisada,
  incluindo conferir UPDATE/DELETE de authenticated sob as RLS já existentes.
  Nenhuma alteração desses privilégios foi criada/aplicada nesta rodada.
- **P2 — resposta nativa do carrinho:** os três testes sem JavaScript falharam.
  O banco confirmou quantidade=2, mas o documento não concluiu navegação.
  As ações de formulário agora redirecionam para o carrinho canônico após
  sucesso, com replace para não empilhar alterações de quantidade no histórico.
  Esse ajuste ainda precisa passar no CI. Erros da ação continuam exibidos no
  fluxo com JavaScript; não declarar validados todos os erros sem JavaScript.
- A concorrência da última unidade está comprovada no laboratório em f53da03:
  dois carrinhos reais bloqueados na entrada da RPC, liberação conjunta,
  apenas um pedido, estoque zero e negativa para o segundo comprador.
  Nenhum teste foi retirado nem a exigência de unicidade foi reduzida.

### Prontidão e decisões humanas

Demonstração com dados sintéticos é possível em ambiente isolado.
**Beta com dados reais e operação comercial continuam NO-GO.** A PR não pode
ser tratada como release verde enquanto as regressões atuais e os gates abaixo
estiverem abertos.

Continuam pendentes os aceites específicos já registrados: piloto B2 real
(destino efetivo, custodiante/cofre, custo, retenção/restore e aprovação);
cutover/revogação comprovada de credenciais; publicação/migration/smoke após
pré-requisitos; sandbox financeiro isolado de MP/Asaas; SMTP hospedado e
canais/responsáveis reais de suporte/alertas. B2 escolhido não autoriza exportar
dados reais. Nenhum segredo deve ser enviado pelo chat.

## Inventário histórico verificado em 05/11

Os números, credenciais por nome, estado Supabase e deployments abaixo foram
conferidos em 05/11; não equivalem a uma nova inspeção de produção em 07/11.

- Código candidato: `c9e525621ecb514df97b9736949c418e0a586e28`,
  [PR #3](https://github.com/jonathagandrade-157/Vexo/pull/3) aberta, branch
  `codex/vexo-launch-blockers`. Main remoto permanece
  `da1ab1d4bcab1be78c332bd50b4305b9e3c887d5`; sem merge nesta etapa.
- Correções novas: cadastro espera confirmação antes de criar loja/trial;
  callback PKCE/OTP, reenvio, expiração, recuperação e retomada autenticada
  em outro navegador; cookie cifrado sem senha/CPF em claro; metadados Auth
  editáveis não autorizam o trial. Retry após falha de trial reutiliza a loja
  incompleta do OWNER em vez de duplicá-la. Mesmo sem cookie, novo login
  identifica a loja sem assinatura e oferece retomada pelo banco. Commits
  `47dfd67`, `27fc263` e `c9e5256`. Duas regressões do destino de login falharam
  antes desta última correção; 29 testes Auth focados e typecheck/lint passaram.
- Validação da última correção:
  [42113857556](https://github.com/jonathagandrade-157/Vexo/actions/runs/42113857556),
  **quatro jobs aprovados**: 1.359 unitários, 738 integrações PostgreSQL,
  16 HTTP e **51/51 E2E**, sem retries, desktop/Pixel 7/360 px;
  audit zero, lint/typecheck/build, rollout e recuperação aprovados.
  O E2E de retomada perde todos os cookies após criar a loja sem trial, faz
  novo login e exige o mesmo tenant após concluir o cadastro: passou nas
  três larguras. Não extrapolar esse resultado para produção.
  [Capturas dessa revisão](https://github.com/jonathagandrade-157/Vexo/actions/runs/42113857556/artifacts/13454064918),
  disponíveis até 12/11.
- Validação anterior do novo Auth (`27fc263`):
  [42111772873](https://github.com/jonathagandrade-157/Vexo/actions/runs/42111772873).
  **Quatro jobs aprovados:** 1.357 unitários, 738 integrações PostgreSQL,
  16 testes HTTP e **51/51 jornadas de navegador**, sem retries, em desktop,
  Pixel 7 emulado e 360 px. Audit sem vulnerabilidades conhecidas,
  lint/typecheck/build, rollout e recovery-lab aprovados.
  Local: 21 regressões Auth e typecheck/lint passaram. Os resultados são
  vinculados a esse SHA, sem extrapolar para o banco/deployment de produção.
- [Evidências sintéticas anteriores de 27fc263](https://github.com/jonathagandrade-157/Vexo/actions/runs/42111772873/artifacts/13454982362),
  15 capturas disponíveis até 12/11. Cópia local ignorada pelo Git em
  `test-results/ci-27fc263`; revisadas visualmente loja recém-publicada no
  Pixel 7, variantes no mobile 360 e carrinho desktop. As jornadas Auth são
  comprovadas pelos testes/estado no banco; não houve entrega de e-mail real.
- A rodada anterior do novo Auth, commit `47dfd67`,
  [42109530181](https://github.com/jonathagandrade-157/Vexo/actions/runs/42109530181),
  passou em 48/51 E2E; três pararam por seletor de alerta que também encontrava
  o anunciador de rotas do Next. Seletor delimitado ao main; todos os 51
  passaram em 27fc263. Nenhum erro da aplicação foi filtrado para obter verde.
- Preview automático do código, READY:
  [c9e5256](https://vexoecommerce-czleb399t-vexo5.vercel.app).
  Deployment `dpl_8ubGHGyCpjaRXWRntJxVJmc93SyU`, SHA correlacionado pela
  listagem Vercel; inspeção individual confirmou ID/estado/target Preview.
  Esse Preview compartilha credenciais de produção e não é sandbox para
  mutações ou finanças. Build pronto não equivale a smoke autenticado aprovado.
- Produção conferida via Vercel: `dpl_AJnRSLMhKw959n5DtwtemJ52ZkJ1`, READY,
  [vexoecommerce-29yh2fret](https://vexoecommerce-29yh2fret-vexo5.vercel.app).
  A PR #3 continua sem publicação em produção; nenhuma migration aplicada.
- Banco somente leitura: PostgreSQL 17.6, última migration
  `20261026210716`, grant SELECT de service_role em products ainda ausente;
  9 arquivos Storage/1.471.843 bytes, Vault 0 e labels TCE 0. PITR desabilitado,
  lista de backups não informada e metadados físicos vazios. WAL habilitado
  não comprova cópia recuperável.
- Auth de produção consultado sem ler usuários: cadastro/e-mail habilitados,
  confirmação de e-mail **desativada**. SMTP/entregabilidade hospedada não
  demonstrados. [Configuração de release](runbooks/auth-email-release.md).
- Metadados de API keys: publishable/secret modernas já existem no projeto;
  nomes modernos ainda ausentes no Vercel Production/Preview. Valores não
  são publicados nem incluídos em commits. Zero Edge Functions no inventário
  do projeto alvo; consumidores externos ainda não confirmados. Nenhuma
  troca/revogação executada.
- B2 escolhido pelo proprietário; ficha concreta preparada em
  [piloto B2](runbooks/backup-pilot-b2.md). Faltam custodiante/cofre, destino
  efetivo, restaurador/orçamento e aprovação específica. Nenhuma exportação
  real nem contratação. Nenhum destino de backup apareceu no inventário
  acessível do executor/Vercel; isso não inventaria contas externas do titular.
- Inventário de nomes Vercel reconferido: credenciais Supabase legadas e MP
  compartilhadas Production/Preview; sem modo MP de teste e sem Asaas.
  Resend/Sentry/CRON_SECRET presentes só em Production; presença não prova
  operação. Homologação externa aguarda ambiente e contas isolados no cofre.
- Perguntas já enviadas e ainda pendentes: custodiante/cofre da chave privada
  e canal/responsável reais de suporte e alertas. Não pedir segredos por chat.

## Evidência histórica — não substitui validação da revisão acima

- **Conjunto funcional aprovado em 05/11:** commit f96086e,
  [CI 42055415140](https://github.com/jonathagandrade-157/Vexo/actions/runs/42055415140),
  quatro jobs verdes: 1.347 unitários, 738 integrações PostgreSQL, 16 HTTP,
  45/45 jornadas de navegador, laboratório de recuperação, audit zero,
  lint/typecheck/build e validação do rollout do carrinho. Categorias,
  produto/estoque, variantes e OPERATOR passaram nas três larguras.
  [Capturas sintéticas](https://github.com/jonathagandrade-157/Vexo/actions/runs/42055415140/artifacts/13429182357)
  disponíveis até 12/11; os resultados de produção continuam pendentes.
- [Rodada 42054094962](https://github.com/jonathagandrade-157/Vexo/actions/runs/42054094962),
  commit 5251f51: 42/45 E2E aprovados; cadastro/persistência de variantes e
  preservação de estoque passaram nas três larguras. Os três testes de
  categoria pararam por dois gatilhos de criação com o mesmo aria-label;
  o botão de criação volta a herdar o texto visível, preservando o nome
  específico na edição. Labels/edição passaram na rodada 42055415140.
- Auditoria de 05/11 encontrou avisos novos em glob e minimatch (13 pacotes
  diretos/transitivos marcados, duas causas). Overrides limitam glob a
  14.0.2 e minimatch vulnerável >=7 a 11.0.1, mantendo minimatch 3 e as
  versões de Next/ESLint/Sentry. Audit local voltou a zero; lint/typecheck
  passaram. Compatibilidade de build/integração confirmada no CI 42055415140.
  Referências: [glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) e
  [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249).
- Inventários somente leitura de 05/11: Preview continua com credenciais
  legadas compartilhadas com produção e sem modo MP de teste; Supabase
  continua com PITR desabilitado, lista lógica não informada e metadados
  físicos vazios. Não existe nova evidência de backup/restore recuperável.
- Retomada em 05/11: PR #3 permanece aberta no HEAD d6c67a1, sem conflito
  com main da1ab1d. [CI 40813679025](https://github.com/jonathagandrade-157/Vexo/actions/runs/40813679025)
  aprovou 1.346 unitários, 738 integrações, 16 HTTP, build/audit/lint/typecheck,
  smoke público e recovery-lab; navegador ficou em 41/45. Três falhas
  demonstraram IDs repetidos nos diálogos de categoria; uma corrida mobile
  mostrou navegação antes da persistência das variantes. Correções usam
  useId e o estado único de salvamento para liberar a navegação somente
  após sucesso. Regressões desktop/mobile passaram na rodada 42055415140.
- Implementados export nativo sem Docker Desktop, criptografia age antes de
  upload, manifesto cifrado, hash/readback, guardas de destino e restore
  sintético vazio. [Procedimento e custo](runbooks/backup-recovery.md).
- [CI 40810300128](https://github.com/jonathagandrade-157/Vexo/actions/runs/40810300128),
  commit 9814a61: quatro jobs verdes; recuperação sintética com pg_dump,
  criptografia real, senha preservada, RLS, histórico e rejeição de corrupção.
  Não comprova recuperação dos serviços Supabase ou armazenamento externo.
- [CI 40807222522](https://github.com/jonathagandrade-157/Vexo/actions/runs/40807222522),
  commit 7ef05de: 36 jornadas de navegador com chaves modernas realmente
  emitidas pela stack Supabase local, sem variáveis legadas no Next.
- Verificador somente leitura de cutover preparado. Exige catálogo moderno
  funcional e carrinho público negado, além de ambas as chaves legadas 401
  após revogação. Em baseline local, negação anônima é 401 (não 403);
  teste foi corrigido sem alterar permissões da aplicação. Nenhuma revogação.
- Inventário Preview Vercel em 29/10: entradas legadas compartilhadas com
  produção e sem MERCADO_PAGO_TEST_MODE. Não é sandbox seguro. A
  [matriz exata de configuração](runbooks/homologation-configuration.md)
  registra nomes, locais, callbacks e evidência externa ainda necessária.
- [Release controlado](runbooks/controlled-release.md) preparado, incluindo
  sequência migration/deploy/revogação, rollback e smoke. Merge-tree sem
  conflito com main da1ab1d; reconferir main e CI do HEAD antes do GO.
- Novas jornadas isoladas de categoria/produto/estoque, variantes e OPERATOR
  passaram no CI 42055415140. A plataforma tem OWNER/ADMIN/MANAGER/OPERATOR/SUPPORT;
  STAFF é tratado pelos papéis de colaborador existentes, sem inventar role.
- Commit 98e971d corrige estoque base e preservação de variantes; 1.346 testes
  unitários locais passaram, além de typecheck e lint dos arquivos alterados.
  CI completo desse conjunto e jornadas novas passou na rodada 42055415140.
- [CI 40812589057](https://github.com/jonathagandrade-157/Vexo/actions/runs/40812589057)
  registrou 39/45 E2E aprovados, inclusive OPERATOR nas três larguras.
  As seis falhas do catálogo pararam no nome acessível do botão Salvar
  (ícone decorativo incluído no nome); o botão foi corrigido. Não contar
  esses cenários como prova do estoque. O laboratório também expôs um path
  incorreto na fixture HTTP de Storage, corrigido conforme o SDK instalado.

Nenhuma exportação real, contratação, alteração de ambiente, OAuth, pagamento,
mensagem, merge ou deploy de produção foi executado nesta sprint. Pushes da
PR geram Previews automaticamente, identificados separadamente. A recusa de acesso do
browser à produção foi respeitada. A aprovação genérica anterior não autoriza
as operações específicas acima.

## Entrega e ambientes

- PR candidata: [#3](https://github.com/jonathagandrade-157/Vexo/pull/3),
  branch `codex/vexo-launch-blockers`, worktree `.worktrees/vexo-security-hardening`.
- Baseline funcional anterior à sprint: `2c33600e32aea4dad28611b6d79906f583a0445c`.
- CI desse baseline: [workflow 40802528351](https://github.com/jonathagandrade-157/Vexo/actions/runs/40802528351), todos os jobs verdes. Não substitui CI do HEAD final.
- Produção: [VEXO](https://vexoecommerce.vercel.app), loja
  [SuperBrands](https://vexoecommerce.vercel.app/loja/superbrands).
- Último deploy de produção verificado anteriormente: PR #2, merge
  `da1ab1d4bcab1be78c332bd50b4305b9e3c887d5`, deployment
  `dpl_AJnRSLMhKw959n5DtwtemJ52ZkJ1`.
- Supabase: projeto `Vexo`, ref `vqbiurnfqkjkrenigxzv`, `us-east-1`.
- A PR #3 não foi mesclada nem publicada em produção. Nenhuma alteração de banco,
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
| Estoque simples falha silenciosamente após adoção de variantes | P1 | Salvar estoque usa ON CONFLICT(product_id), mas o índice agora é parcial; falha de escrita não era verificada | Escrita base com update/insert e retry limitado de concorrência; falha parcial explícita preserva ID criado para não duplicar produto; regressão focada reproduziu o falso sucesso antes da correção |
| Edição base pode remover estoques das variantes | P1 | Salvar produto com estoque base vazio excluía todas as linhas product_inventory daquele produto | Leitura, update e delete base filtram variant_id IS NULL; três estoques de variantes preservados nas três larguras no CI 42055415140 |
| Botão Salvar produto inclui nome do ícone | P2 | Leitor de tela/navegador identifica save + Salvar produto | Ícone decorativo aria-hidden, repetindo o contrato acessível do botão de login; jornada E2E usa nome visível exato |
| Labels de categoria apontam para outro diálogo | P2 | Abrir edição após criar categoria; ids name/description repetidos associam label ao campo oculto de outro modal | useId por formulário, nome acessível do diálogo e do gatilho; reprodução falhou nas três larguras antes da correção |
| Cadastro pode navegar antes de persistir variantes | P1 | Galeria vazia termina enquanto configuração ainda está idle; abertura de edição pode encontrar zero variantes | Navegação passa a usar o mesmo computeSaveStatus da confirmação visual e exige done; reprodução mobile e regressão do estado idle |
| Cadastro com confirmação de e-mail tenta gravar sem sessão | P1 | Auth retorna usuário sem sessão; ação antiga atualiza perfil antes da confirmação e falha | Aguarda confirmação, callback PKCE/OTP e retomada autenticada; regressão unitária falhou antes da correção |
| Falha ao iniciar trial deixa cadastro sem caminho de retomada | P1 | Loja foi criada, RPC do trial falha; retry ou novo login após perder cookie pula para onboarding sem trial | Login consulta assinatura no banco; reusa apenas loja incompleta do OWNER sem assinatura; elegibilidade continua no RPC; regressão de erro temporário e perda de estado sem create_tenant adicional |

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
| Isolamento | Segredo alterado e cookie reaproveitado em outra loja não revelam itens; carrinho original permanece acessível ao dono; OPERATOR pode ver pedidos e não pode criar produto ou gerir equipe nas três larguras | Matriz completa dos outros papéis no navegador ainda pendente |
| Variantes e estoque | Seleção por teclado, variante ativa com promoção, bloqueio de variante sem estoque/inativa e produto simples sem estoque; variante/preço/quantidade persistem no carrinho; três variantes montadas antes do cadastro persistem com preço correto e seus estoques sobrevivem à edição base | Checkout completo de variantes e mudanças concorrentes de estoque ainda precisam de E2E de navegador; integração PostgreSQL existente não substitui essa jornada |
| Checkout | Campos obrigatórios, foco no primeiro campo inválido, complemento opcional, criação em dinheiro e confirmação após reload | PIX/cartão e gateways reais não validados |
| Pedido | Pedido único no banco, baixa única de estoque, leitura no painel, confirmação manual sintética de pagamento, avanço para PREPARING e histórico; status não baixa estoque novamente | Todos os status, cancelamentos e filtros ainda sem cobertura completa de navegador |
| Painel | 17 rotas: HTTP 200, título visível e ausência de overflow/erros de console/hidratação; logout encerra a sessão e acesso posterior volta ao login | Leitura de página não valida todos os controles |
| Configurações | Nome vazio rejeitado sem alterar o banco; perfil/endereço persistem após reload; valores originais restaurados pela própria UI | Pagamentos, pedidos, entrega, domínio e plano ainda precisam de mutações completas |
| Cadastro e onboarding | Termos/senhas, OWNER/trial único, documento HMAC, retomada sem cookie, bloqueio de salto e publicação; confirmação habilitada com Mailpit seguindo links efetivamente emitidos nas três larguras, CI 42113857556 | SMTP/entrega externos e configuração hospedada seguem pendentes |
| E-mail Auth e recuperação | PKCE e token_hash, expiração real de timestamp sintético, reenvio, reutilização negada, senha antiga negada/nova aceita e retomada em outro navegador; cookie cifrado/tamper/usuário/TTL e metadados falsificados | Mailpit local, sem e-mail externo; não equivale a homologação SMTP. Ver CI da revisão atual |
| Catálogo e aparência | Home/detalhes/âncoras, estados vazios, leitura/prévia de aparência; categoria criada, renomeada, desativada e reativada; produto simples criado e editado com categoria, preço e estoque 8→3 preservados após reload | Banners, upload/galeria e restauração completa da aparência ainda pendentes; não houve exclusões de dados existentes |
| Equipe e histórico | Rotas de leitura, auditoria do pedido e OPERATOR autorizado a pedidos e bloqueado em criação de produtos/equipe | Nenhum convite enviado; outros papéis ainda sem jornada completa de navegador |
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
| P0 | Backup e restore não comprovados | B2 escolhido; preencher custodiante/cofre e destino efetivo da ficha, aprovar piloto específico e demonstrar restore Auth/Storage e Vault quando aplicável |
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

## Próximas operações prontas ou em preparação

1. Completar as mutações e jornadas ainda pendentes na matriz, sem expandir
   módulos “em breve” e sem comunicação, OAuth ou transação real.
2. Concluir a ficha B2 com bucket/custodiante/cofre/custo e obter autorização específica
   para o piloto de backup e restore isolado. Meta RPO24h/RTO4h ainda não medida.
3. Aprovar configuração moderna e revogação, com consumidor/rollback compatível
   e prova de acesso antigo negado. Produção permanece sem alteração.
4. Obter GO técnico específico para migration/deploy e smoke quando os P0
   estiverem fechados. Homologação Asaas não precisa bloquear esse hotfix.
5. Separar sandbox e executar homologação financeira autorizada; validar
   SMTP hospedado, jornadas restantes e operação para os primeiros clientes.

| Decisão | Veredito atual | Falta para mudar |
| --- | --- | --- |
| Demonstração | Permitida no laboratório sintético; Preview apenas com limites de leitura | Não usar demonstração como prova de recuperação/produção ou como autorização para inserir dados de clientes |
| GO técnico | NO-GO de execução | Backup real recuperado, troca/revogação aprovadas e verificadas, HEAD CI aprovado e GO de release |
| Beta gratuito supervisionado | NO-GO com dados reais | Gates de segurança/recuperação, hotfix publicado e jornadas essenciais aceitas com limitações explícitas; não depende de habilitar cobranças reais |
| GO comercial | NO-GO | Beta aceito, MP/Asaas homologados, e-mail/suporte/alertas operacionais e revisão humana das políticas |
