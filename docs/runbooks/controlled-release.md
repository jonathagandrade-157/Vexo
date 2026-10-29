# PR #3 — release controlado

Preparado em 29/10/2026. Nenhum merge, migration ou deploy autorizado por
este documento. Tratar GO técnico, beta e comercial como decisões distintas.

## Gates antes de solicitar GO técnico

1. Fixar SHA integral do HEAD revisado e CI desse SHA com todos os jobs
   aprovados. Confirmar que main não mudou e repetir merge-tree se mudar.
   Merge sem conflitos verificado contra main
   `da1ab1d4bcab1be78c332bd50b4305b9e3c887d5`; não alterar o checkout principal.
2. Backup externo criptografado restaurado no destino isolado e evidência
   aceita conforme backup-recovery.md. Laboratório sintético não fecha gate.
3. Chaves modernas testadas no projeto alvo, inventário de consumidores e
   candidato/rollback compatíveis prontos. Aprovação explícita da troca e
   revogação; acesso legado só está encerrado quando probe after-revoke passa.
4. Listar migrations remotas imediatamente antes da janela. Pendência
   esperada da PR é somente `20261027150000_cart_product_read_grant.sql`.
   Se existir outra pendência, interromper e revisar; não usar push cego.
5. Registrar operador, janela, deployment atual, candidato e rollback,
   configuração (nomes/IDs), smoke, gatilhos de interrupção e GO explícito.

Asaas não bloqueia um hotfix técnico quando esses gates estiverem satisfeitos.
Beta exige recuperação/segurança e limitações explícitas; comercial exige
também pagamentos, assinaturas, suporte e operação validados.

## Migration mínima revisada

O único SQL novo concede SELECT de `public.products` a `service_role`.
Não altera dados, RLS, grants anon/authenticated ou migrations históricas.
É necessário para o embed cart_items → products no BFF administrativo;
BYPASSRLS não concede privilégios SQL de tabela automaticamente.
Integrações verificam o join real e que o browser não lê carrinhos diretamente.

## Ordem exata após autorização

1. Congelar SHA, registrar GO e baseline, conferir backup e configuração de
   chaves modernas. Restringir merge/autodeploy à janela; merge da PR pode
   disparar produção automaticamente na Vercel.
2. No alvo confirmado, aplicar **somente** a migration revisada pelo mecanismo
   normal de migrations com histórico. Registrar versão e privilégios antes/
   depois. Não executar migration histórica, seed ou reset.
3. Configurar os nomes modernos nos consumidores aprovados e disparar build
   novo do SHA revisado. NEXT_PUBLIC exige rebuild. Repetir baseline do probe.
4. Fazer merge/promoção apenas na janela autorizada, validar deployment e
   commit efetivos; nunca promover um Preview com banco/chaves sandbox.
5. Smoke público e de sessão abaixo. Se falhar, parar antes de revogar.
6. Com GO de revogação e consumidores migrados, desativar API keys legadas.
   Rodar probe after-revoke e repetir sessão nova/reload/smoke. Remover nomes
   legados dos ambientes aprovados; registrar IDs/horários, nunca valores.
7. Monitorar logs sanitizados e alertas durante a janela; fechar registro
   técnico somente com evidências. Não liberar cobrança por inferência.

## Rollback

Antes da revogação: reverter/preservar deployment anterior só se continuar
seguro e funcional, ou corrigir candidato. Após revogação: usar artefato
revisado compatível com chaves modernas. Deployment antigo que depende de
JWT legado não serve como rollback; não reativar chave potencialmente exposta.
Preparar esse artefato antes de executar a troca.

Banco: grant é aditivo, sem transformação de dados, e pode permanecer ao
reverter código compatível. Se a contingência aprovada exigir remover o
acesso, SQL compensatório é `revoke select on table public.products from
service_role;`, com impacto conhecido: leitura do carrinho volta a falhar.
Registrar nova migration compensatória; não apagar histórico nem fazer reset.
Restore é para corrupção/perda de dados e exige procedimento específico;
não restaurar produção indiscriminadamente por falha visual.

## Smoke pós-deploy

- SuperBrands: home/quatro produtos/âncoras e nenhuma navegação interna 404.
- Carrinho: adicionar, reload, quantidade, remoção, totais e isolamento por loja.
- Checkout: validações até antes da confirmação; pedido sintético completo
  somente no ambiente e escopo especificamente aprovados.
- Lojista: login/sessão nova, painel, produtos, pedidos e configurações.
- Cron sem pagamentos pendentes: resposta vazia normal, sem inicializar MP.
- Console/hidratação, HTTP, logs, autorização e páginas desktop/Pixel 7.
- Probe: moderno funcional e público sem acesso direto a carrinhos;
  chaves antigas 401 após revogação.

Interromper se houver erro de autenticação, carrinho vazio incorreto,
divergência de estoque/total, acesso cruzado, migration inesperada ou
integração externa disparada fora do escopo. O acesso browser de produção
foi negado pelo controle de origem nesta sessão; é necessário liberar a
superfície autorizada ou operador executar esse smoke. Não contornar o bloqueio.
