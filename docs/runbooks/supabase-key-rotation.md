# Rotação das chaves Supabase do VEXO

Estado: procedimento preparado; nenhuma chave criada, substituída ou
revogada por este documento. Execução em produção requer GO do proprietário.
Projeto esperado: `vqbiurnfqkjkrenigxzv`. Uma exposição potencial mantém o
lançamento bloqueado até a revogação efetiva ser comprovada.

## Consumidores e release candidato

| Consumidor | Variável nova | Validação |
| --- | --- | --- |
| Browser, SSR com usuário e vitrine pública | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Login, refresh, catálogo, upload autorizado e isolamento por sessão. |
| Servidor administrativo/BFF | `SUPABASE_SECRET_KEY` | Carrinho, checkout, webhooks, cron e operações administrativas. |
| Jobs e serviços fora do repositório | Inventariar antes de revogar | Proprietário confirma que nenhum consumidor depende do JWT legado. |

A PR #3 normaliza os nomes novos em `lib/env.ts`, prefere as chaves novas
e mantém fallback temporário. O browser lê o nome público literalmente
para o Next.js incorporar o valor no build. O cliente administrativo usa
`supabase-js` sem sessão, refresh ou cookies de usuário.

## Sequência de execução aprovada

1. Confirmar projeto, ambientes, operador e commit aprovado. Registrar
   somente nomes/IDs de chaves e horários. Nunca guardar valores no relatório.
2. Criar/obter as chaves modernas na área API Keys do projeto. Configurar
   os dois nomes novos diretamente no cofre de variáveis do ambiente de
   homologação. Chave secreta nunca recebe prefixo `NEXT_PUBLIC_`.
3. Rebuildar e validar homologação com os nomes legados ausentes: login,
   renovação da sessão, carrinho/reload, checkout sintético, isolamento,
   leitura do pedido no painel e cron. Testes unitários com formato
   moderno não substituem esta verificação com chaves emitidas pelo serviço.
4. Após GO, configurar os dois nomes novos em produção, gerar build novo
   e promover o deployment revisado. Conferir health, Auth, carrinho e
   logs sanitizados. Guardar deployment anterior e candidato.
5. Confirmar os demais consumidores: funções, webhooks de banco, jobs e
   integrações operacionais. Para chamadas HTTP diretas com chave opaca,
   revisar o header `apikey`; ela não deve ser tratada como um JWT de usuário.
6. Com GO específico para a revogação, desativar as API keys legadas no
   projeto. Isto inclui o impacto no `anon` legado, não apenas no servidor.
7. Em verificação somente leitura, confirmar que o antigo acesso deixou
   de autorizar chamadas e que as chaves novas continuam funcionando.
   Guardar status HTTP, nunca headers ou valores. Repetir smoke público,
   sessão do lojista e alertas. Retirar variáveis legadas dos consumidores.

Builds/abas antigos podem carregar o `anon` anterior. Testar reload e nova
sessão após a revogação; indicar atualização da página em caso de sessão
antiga. Previews que usam o mesmo banco também precisam de rebuild.

## Recuperação e encerramento

Se o candidato falhar antes da revogação, interromper a promoção e corrigir
o consumidor. Depois da revogação, recuperar com uma versão compatível
com as chaves novas. Um deployment que só usa JWT legado não serve como
rollback seguro. Não reativar uma chave potencialmente comprometida como
procedimento rotineiro.

O registro de conclusão deve conter commit, deployments, consumidor,
horários de substituição/revogação, status dos smokes e responsável.
Rotações de API keys não equivalem à rotação das signing keys do Auth;
não mudar esta segunda configuração sem uma avaliação específica.

Referência: [migração oficial das API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
