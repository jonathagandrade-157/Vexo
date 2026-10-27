# Backup e recuperação do VEXO

Estado em 2026-10-27: nenhum backup recuperável/restore comprovado;
`pitr_enabled=false` e lista de backups indisponível. Sem mudança de
infraestrutura, contratação ou exportação de dados autorizada neste roteiro.
Nenhuma nova migration de produção deve avançar antes deste gate.

## Decisão necessária do proprietário

Escolher o mecanismo e aprovar destino, acesso, retenção, custo e responsável:

- Backup gerenciado do Supabase, com ponto disponível e restore de teste
  em projeto separado; avaliar PITR conforme a perda de dados aceitável.
- Backup lógico recorrente para destino criptografado fora do projeto de
  origem, com alarme de falha e restore de teste em ambiente isolado.

Proposta operacional para aprovação: cópia diária, retenção diária de 14
dias, RPO alvo de 24 horas e RTO alvo de 4 horas. São metas propostas,
não capacidades demonstradas nem compromisso comercial já assumido.

## Conteúdo necessário para recuperar o produto

| Conjunto | Verificação no restore |
| --- | --- |
| Dados e schema da aplicação | Tenants, membros, planos, catálogo, estoque, carrinhos, pedidos e históricos consistentes. |
| Auth, roles, RLS, RPCs e histórico de migrations | Login, isolamento e privilégios iguais aos esperados; nenhuma migration reaplicada por falta do histórico. |
| Supabase Vault | Os vaults de pagamento e entrega usam segredos cifrados; testar capacidade de recuperação sem exibir tokens. |
| Objetos Storage | Produtos, logos e banners recuperáveis, além dos respectivos metadados. |
| Configuração externa | Inventário de nomes de variáveis, URLs de callback, jobs, webhooks e responsáveis; segredos em cofre separado. |

O backup do banco não contém os arquivos do Storage. Um dump também não
comprova por si a recuperação das chaves de criptografia do Vault.
O plano deve cobrir ambos antes de receber aprovação.

## Execução depois da aprovação

1. Conferir explicitamente a origem `vqbiurnfqkjkrenigxzv` e o destino
   separado. Registrar operador e janela. Proteger os artefatos fora de
   Git, chat, anexos e pastas sincronizadas sem controle de acesso.
2. Fazer a cópia pelo mecanismo escolhido. Para backup lógico, seguir o
   roteiro oficial de roles, schema e dados, preservando o histórico de
   migrations e o tratamento específico do Vault. Usar credenciais via
   cofre/meio seguro, sem colocá-las em comando salvo ou logs.
3. Copiar os objetos Storage com manifesto de caminhos, tamanho e hash;
   verificar quantidade e amostra de integridade. Criptografar e verificar
   o upload no destino aprovado antes de considerar a cópia concluída.
4. Preparar destino vazio e isolado, com saída de e-mail, pagamentos,
   OAuth, cron e webhooks externos bloqueada. Uma restauração contém
   dados e possivelmente tokens reais; jamais ativar integrações com eles.
5. Restaurar no destino aprovado. Validar schema, dados, RLS, Auth,
   histórico de migrations, objetos e integridade dos vaults sem chamadas
   aos provedores. Rodar smoke com catálogo e usuário sintéticos.
6. Medir o intervalo entre a última cópia íntegra e a falha simulada
   (RPO), e entre o início da recuperação e a aprovação do smoke (RTO).
7. Configurar recorrência/retenção e alerta em canal aprovado. Simular
   uma falha da tarefa e confirmar recebimento do alerta antes de fechar.

## Registro obrigatório de evidência

| Campo | Valor atual |
| --- | --- |
| Método e data da cópia | Pendente |
| Destino protegido e operador | Pendente |
| Manifesto, tamanho e hash | Pendente |
| Restore isolado concluído em | Pendente |
| RPO/RTO medidos | Não demonstrados |
| Storage e Vault validados | Pendente |
| Recorrência e alerta testados | Pendente |

Referências: [backups](https://supabase.com/docs/guides/platform/backups)
e [backup/restore via CLI, incluindo Vault e migrations](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
