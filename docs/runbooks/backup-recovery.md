# Backup e recuperação do VEXO

Atualização: 2026-10-29. **P0 aberto.** Implementação preparada e laboratório
sintético aprovado; nenhuma cópia de produção foi exportada. A escolha
anterior de backup lógico externo não autoriza destino, custo ou exportação.

## Proposta concreta para aprovação

Destino recomendado: bucket privado Backblaze B2 compatível com S3, exclusivo
do proprietário, prefixo `vexo/production`. Nome final, região, titular e
custodiante precisam ser definidos. Alternativa: bucket S3 privado existente
que satisfaça as mesmas verificações. Não foi criada conta nem contratado serviço.

- Criptografia local com age antes do upload, inclusive manifesto, paths do
  Storage, SQL e código implantado. Nenhum SQL em claro no disco.
- Cópia diária, retenção mínima de 14 dias com Object Lock GOVERNANCE; chave
  do executor sem excluir, contornar retenção ou configurar bucket. A ativação
  de Object Lock não pode ser desfeita: faz parte da aprovação do destino.
- Chave S3 restrita a bucket/prefixo com leitura para verificar o ciphertext
  enviado e escrita. Restauração usa outra chave, somente leitura.
- Executor recebe só o destinatário público age. Identidade privada em
  cofre do custodiante e cópia offline. Outra identidade para eventual chave
  raiz Supabase; não guardar as duas identidades no executor ou junto das cópias.
- Linux com Node >=20, bash, PostgreSQL client >=17, age, AWS CLI e Supabase CLI
  2.115.0. Usa o plano oficial de dump (--dry-run) com ferramentas nativas;
  não requer Docker Desktop. O laboratório CI usa PostgreSQL descartável.
- Staging efêmero fora de Git/OneDrive, permissões 0700/0600, executor sem
  set -x, sem upload automático de diretórios de backup como artefatos CI.

Preço consultado em 29/10: B2 US$6,95/TB/mês, primeiros 10 GB gratuitos.
Exemplo de 5 GB por cópia ×14 =70 GB: aproximadamente **US$0,42/mês de
armazenamento** após franquia. Exclui impostos, câmbio, runner, chamadas não
gratuitas e egress Supabase. Não é proposta comercial fechada.
Consulta agregada de produção em 29/10: PostgreSQL 17.6, banco físico
16.419.987 bytes, 9 objetos/1.471.843 bytes, Vault 0 segredos e 0 labels de
criptografia pgsodium. Isso sugere volume pequeno; tamanho comprimido e uso
mensal só serão conhecidos no piloto aprovado. Não prometer custo total zero.

Fontes: [preço B2](https://www.backblaze.com/cloud-storage/pricing),
[Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock),
[chaves restritas](https://www.backblaze.com/docs/cloud-storage-application-keys),
[egress Supabase](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

## Implementação e limites

scripts/backup/export.mjs: snapshot read-only compartilhado entre schema e
dados; roles, schema/data filtrados pela CLI oficial, histórico de migrations,
Vault separado, arquivos do Storage e código Git do commit implantado. Cifra
cada componente, envia nomes únicos e baixa o ciphertext para comparar SHA-256.
Manifesto enviado por último. Recusa bucket público, retenção insuficiente,
origem divergente e pooler transacional (6543). Mudança de Storage durante o
export aborta o bundle. Objetos >64 MiB abortam até existir streaming; o
limite de imagem atual da aplicação é 5 MB.

O manifesto nunca declara restore aprovado automaticamente. ACL/Object Lock,
upload e readback contra B2 precisam de ensaio autorizado; o laboratório
não prova compatibilidade externa. Falhas de rede e particularidades do
provedor podem exigir ajuste antes de aceitar o primeiro backup.

Auth: preserva linhas e hashes de senha, mas recuperar o serviço também exige
SMTP, providers, redirects, configuração Auth e estratégia de sessões.
Customizações em schemas gerenciados devem ser conferidas pelas migrations
versionadas; não assumir que o filtro padrão inclui todo trigger customizado.
Storage exige arquivos e metadados: dump SQL sozinho não contém os arquivos.

Vault/TCE: a chave raiz de criptografia não está no dump. O exporter exige
recibo de escrow separado quando encontra segredos Vault ou labels TCE.
No estado observado (ambos zero), não exige exportar uma chave raiz sem uso.
**Antes de ativar integrações que armazenam tokens no Vault**, preparar e
validar esse escrow. vault-escrow.mjs cifra a raiz e verifica a cópia com
identidade distinta; só consulta a API real com aprovação específica.
API keys, signing keys do Auth e chave raiz Vault são credenciais diferentes.

## Configuração do executor (valores somente em cofre)

| Nomes | Uso |
| --- | --- |
| BACKUP_SOURCE_PROJECT_REF | vqbiurnfqkjkrenigxzv |
| BACKUP_SOURCE_DATABASE_URL | Direct/session pooler 5432; jamais argv/log |
| BACKUP_PGSSLROOTCERT_FILE | CA verificada; TLS verify-full |
| BACKUP_SOURCE_API_URL, BACKUP_SOURCE_SECRET_KEY | Mesmo projeto; key moderna sb_secret_ |
| BACKUP_OUTPUT_DIR, BACKUP_AGE_RECIPIENT | Staging protegido e destinatário público |
| BACKUP_DESTINATION | s3://BUCKET-APROVADO/vexo/production |
| BACKUP_RELEASE_COMMIT | SHA completo efetivamente implantado |
| BACKUP_S3_ENDPOINT, BACKUP_S3_REGION | Endpoint HTTPS e região do bucket |
| BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY | Chave restrita do executor |
| BACKUP_APPROVED_PROJECT_REF, BACKUP_APPROVED_DESTINATION, BACKUP_APPROVAL_REFERENCE | Correspondência exata com autorização registrada |
| BACKUP_VAULT_ESCROW_RECEIPT | Recibo verificado se Vault/TCE contiver dados cifrados |

Flags de aprovação são guardas contra erro, não substituem autorização
humana. Não solicitar valores secretos por chat. Não usar env de produção
no workflow de pull requests.

Inspeção sem exportar:

```sh
node scripts/backup/export.mjs --plan
node scripts/backup/vault-escrow.mjs --plan
node scripts/backup/restore-lab.mjs --plan
```

Somente no runner aprovado, com configuração injetada pelo cofre:
`node scripts/backup/export.mjs --execute`. A primeira execução permanece
manual. Agendamento não foi ativado e depende do piloto completo.

## Restore isolado e aceite

1. Aprovar destino, orçamento, custodiante, janela, origem e projeto vazio de
   recuperação; dados reais no restore também precisam de autorização.
2. Preparar projeto isolado com egress bloqueado para e-mail, pagamentos,
   OAuth, cron e webhooks. Registrar PostgreSQL/extensões/configuração.
3. Registrar hash do manifesto em canal protegido separado. Baixar ciphertext;
   verificar hashes, posse das identidades e leitura dos objetos.
4. Restaurar roles, schema/customizações, histórico e dados conforme guia
   oficial. Se houver Vault/TCE, transferir a raiz antes da validação de
   descriptografia; trocar raiz de destino com dados pode torná-los ilegíveis
   e não é permitido neste ensaio.
5. Recriar configuração Auth/Storage, subir objetos e comparar hashes e
   contagens. Testar login sintético/senha preservada, RLS OWNER/STAFF/outra
   loja, catálogo, estoque, carrinho/pedido e histórico. Não chamar provedores
   com tokens recuperados. Invalidar sessões conforme plano.
6. Registrar duração, última cópia íntegra e RPO/RTO observados.
   Metas propostas: RPO24h/RTO4h; não demonstradas em produção.
7. Após aceite, aprovar rotina diária e canal de alerta. Alertar em job falho,
   upload/hash incompleto ou ausência de manifesto verificado há >26h.
   Simular falha e confirmar recebimento. Registrar restore mensal.
   Limpeza após retenção é tarefa separada do custodiante, nunca sync --delete.

restore-lab.mjs aceita exclusivamente origem sintética local e destino
loopback vazio; **não é executor de restore de produção**. A recuperação real
exige procedimento específico acima, revisado para o destino aprovado.

## Evidências e gate

[CI 40810300128](https://github.com/jonathagandrade-157/Vexo/actions/runs/40810300128),
commit 9814a61: roundtrip PostgreSQL nativo + age real em 6,96 segundos,
hash de senha preservado, RLS dono/outra identidade, histórico de migrations,
binary packaging, chave errada e corrupção rejeitadas. Auth/Vault são fixtures
SQL/pgcrypto; não são prova dos serviços Supabase nem do transporte externo.
Uma rodada posterior cobre recusa de escrow ausente e Vault vazio.

| Aceite de produção | Estado |
| --- | --- |
| Destino privado, região, custodiante, custo e aprovação | Pendente |
| Exportação e readback externos íntegros | Não executados |
| Restore Supabase isolado com Auth/Storage | Não executado |
| Vault/TCE quando usado | Escrow obrigatório; atualmente sem dados |
| Recorrência, retenção e alerta demonstrados | Pendente |
| RPO/RTO reais | Não medidos |

Referência: [guia oficial de backup/restore, Vault e migrations](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
