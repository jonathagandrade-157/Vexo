# Piloto B2 — ficha de execução e aceite

Preparado em 05/11/2026. **Não executado; não é autorização de exportação.**
O proprietário escolheu a proposta B2. A escolha não inclui contratação,
ativação de Object Lock, exportação nem restauração de dados pessoais.
Esta ficha torna a próxima aprovação delimitada e verificável.

## Escopo proposto

| Item | Proposta / estado verificado |
| --- | --- |
| Origem | Supabase VEXO `vqbiurnfqkjkrenigxzv`, US East, PostgreSQL 17.6 |
| Código a arquivar | SHA integral do deployment efetivamente em produção na janela; não assumir que o HEAD da PR foi publicado |
| Destino escolhido | Backblaze B2; bucket privado sugerido `vexo-backups-producao`, US East, prefixo `vexo/production`; disponibilidade e endpoint a confirmar na conta do proprietário |
| Volume conhecido | 9 arquivos Storage, 1.471.843 bytes agregados na leitura de 05/11; o export confere novamente o inventário na janela |
| Criptografia | age no executor antes do upload, inclusive manifesto; TLS verificado na origem e no destino |
| Retenção proposta | 14 dias em Object Lock GOVERNANCE; ativação irreversível do recurso depende de aprovação expressa |
| Custodiante | Proprietário deve identificar responsável e cofre; pergunta já enviada. Nenhuma identidade privada será solicitada por chat |
| Recuperação proposta | Stack Supabase completa em VM Linux temporária isolada, sem portas públicas e sem dados anteriores; aprovar destino/executor e orçamento antes de copiar dados reais |
| Metas a medir | RPO 24 h e RTO 4 h propostos; não são resultados medidos nem compromisso comercial |

O ambiente de recuperação terá Auth, PostgREST e Storage reais, PostgreSQL
compatível com a origem e extensões conferidas. Uma base PostgreSQL simples
não comprova recuperação desses serviços. SMTP será uma caixa local sem
saída, pagamentos/OAuth/WhatsApp/webhooks/cron ficarão desabilitados e o
firewall permitirá somente acessos necessários à cópia, sem comunicação
externa pelas aplicações restauradas. A VM e seu custo ainda não foram
selecionados ou contratados.

## O que entra na cópia e o que exige tratamento separado

| Componente | Procedimento |
| --- | --- |
| Roles, schema e dados | Planos oficiais de dump da CLI 2.115.0 executados com pg_dump nativo e snapshot read-only compartilhado |
| Histórico de migrations | Schema e dados de `supabase_migrations` separados; comparar versão implantada e customizações em schemas gerenciados |
| Auth | Linhas e hashes de senha; validar serviço e login somente com identidade sintética aprovada, sem redefinir senha de clientes |
| Storage | Metadados no banco **e arquivos separados**, cifrados com nomes opacos; comparar quantidade, bytes e hashes após restaurar |
| Vault / TCE | Consulta de 05/11: 0 segredos e 0 labels. Recontar antes de exportar. Se houver dados cifrados, interromper até escrow separado da raiz, outra identidade/cofre e aprovação específica |
| Código | `git archive` do SHA em produção, cifrado; não contém `.env` ou credenciais |
| Configuração Auth/Storage/SMTP/providers | Inventário sanitizado e configuração do destino revisada separadamente; dump SQL não recria infraestrutura, remetentes, DNS nem integrações |
| API keys, signing keys e segredos de ambiente | Não são recuperados pelo SQL. Custódia/configuração em cofre separado; política de novas sessões/chaves antes de eventual retorno a serviço |

O exporter aborta em mudança concorrente do inventário Storage, objeto acima
de 64 MiB, destino público, retenção insuficiente, TLS inválido, origem/destino
divergentes ou ausência de aprovação exata. Não alterar nem congelar dados
reais silenciosamente para fazer o piloto passar.

## Preparação antes de pedir aprovação de execução

1. Registrar titular/ID da conta B2, bucket disponível, região e endpoint
   efetivos, destino da VM, operador, janela e teto de custo. Nomes e IDs
   podem constar da ficha; chaves ficam somente no cofre.
2. O custodiante gera a identidade age em dispositivo protegido, guarda a
   identidade privada no cofre escolhido e uma cópia offline, e entrega ao
   executor apenas o destinatário público. Demonstrar descriptografia de um
   arquivo sintético antes de usar dados reais.
3. Preparar executor Linux temporário fora de Git/OneDrive, diretórios 0700,
   arquivos 0600, sem logs de shell com valores e sem sincronização automática.
   Instalar Node >=20, bash, PostgreSQL client >=17, age, AWS CLI e CLI Supabase
   2.115.0. Conferir CA e TLS verify-full. Nenhum segredo em argv.
4. Configurar a chave B2 restrita ao bucket/prefixo, leitura para readback e
   escrita; sem delete, bypass de retenção ou configuração do bucket. Preparar
   outra chave somente leitura para a restauração. Se o provedor não atender
   às verificações do script, parar e revisar; não enfraquecer as guardas.
5. Ensaiar ACL/Object Lock/upload/download com **objeto sintético**, depois
   da aprovação para provisionar o destino. Ainda não houve esse ensaio no B2.
6. Preencher a aprovação específica abaixo; somente depois injetar no cofre
   os nomes documentados em [backup-recovery.md](backup-recovery.md).

## Registro de aprovação específica a preencher

- Responsável/custodiante e cofre: **pendente**.
- Conta B2, bucket, região e endpoint efetivos: **pendentes**.
- Executor e destino de restauração isolado: **pendentes**.
- Teto de custo, operador e janela: **pendentes**.
- Aceite explícito para provisionar e ativar Object Lock: **pendente**.
- Aceite para exportar banco/Auth/Storage de `vqbiurnfqkjkrenigxzv` ao destino
  exato e restaurar esses dados no ambiente isolado identificado: **pendente**.
- Referência da aprovação: **pendente**; registrar em `BACKUP_APPROVAL_REFERENCE`.

Preço de armazenamento consultado em 05/11: US$6,95/TB/mês com primeiros
10 GB gratuitos. Cenário ilustrativo 5 GB × 14 cópias: cerca de US$0,42/mês
de armazenamento após franquia. Não estima VM/runner, impostos, câmbio,
chamadas cobradas ou egress Supabase. O teto total precisa ser aprovado.
[Tabela oficial B2](https://www.backblaze.com/cloud-storage/pricing).

## Execução e evidências depois da aprovação

1. Confirmar origem, deployment/SHA, migrations, inventário agregado e ausência
   de novas dependências Vault. Rodar `export.mjs --plan`, sem dados.
2. Conferir as três guardas de aprovação exata e executar manualmente
   `node scripts/backup/export.mjs --execute` no executor aprovado.
   Não usar workflow de PR nem exportar para o computador sincronizado.
3. Só aceitar bundle completo: cada ciphertext enviado e relido com SHA-256
   correspondente, manifesto cifrado publicado por último e hash guardado
   em canal protegido separado. Registrar IDs, horários, bytes e resultados;
   nenhum nome de cliente, path de arquivo, token ou SQL no relatório público.
4. Baixar com chave somente leitura. O custodiante libera a identidade privada
   apenas no restaurador. Seguir a ordem de restore oficial, conferir schema,
   grants, extensões, migrations, triggers e roles antes das jornadas.
   `restore-lab.mjs` é **somente sintético** e não será usado para esse restore.
5. Recriar Auth/Storage isolados, restaurar os arquivos e comparar hashes e
   contagens. Conferir que e-mail externo e integrações continuam bloqueados.
6. Validar com identidades e lojas sintéticas aprovadas: login com hash
   preservado, negação anônima de carrinhos, RLS entre duas lojas, catálogo,
   variantes, pedido/estoque/histórico. Não usar sessão/senha de clientes reais
   nem chamar tokens de provedores recuperados.
7. Registrar início/fim, ponto da cópia, RPO/RTO observados, divergências e
   aprovação/rejeição do aceite. Falha em qualquer etapa mantém o P0 aberto.
8. Encerrar VM e staging conforme retenção aprovada para o piloto, revogar
   acessos temporários e documentar descarte seguro; não apagar as cópias
   protegidas antes do prazo. Agendamento diário é decisão posterior.

Somente depois do piloto aceito: definir rotina diária, ensaiar alerta real
de falha/hash e ausência de manifesto por >26 h e programar restore mensal.
O canal e responsável por alertas já foram solicitados e permanecem pendentes.

Referência de restore:
[Supabase — backup e restauração](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
