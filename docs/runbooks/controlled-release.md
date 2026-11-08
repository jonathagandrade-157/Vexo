# Release controlado — candidato consolidado (PR #3 + PR #4)

Atualizado em 08/11/2026. **Este documento não autoriza** merge na `main`,
deploy, migration, troca ou revogação de credenciais, nem qualquer mutação
em produção. Cada etapa marcada com 🔒 exige o GO específico do proprietário,
registrado antes da execução. GO técnico (hotfix), beta e comercial são
decisões distintas.

## Candidato

| Item | Valor |
| --- | --- |
| Branch candidata | `codex/vexo-launch-blockers` (PR #3); PR #4 incorporada por fast-forward |
| SHA candidato | ver PR #3 / `docs/RELEASE_READINESS.md` (SHA integral, CI e homologação do mesmo SHA) |
| Produção atual | deployment `dpl_AJnRSLMhKw959n5DtwtemJ52ZkJ1`, commit `da1ab1d` (rollback de código) |
| Banco de produção | `vqbiurnfqkjkrenigxzv`, 123 migrations, última `20261026210716` |
| Migrations do release | 5, listadas abaixo; `node scripts/operations/release-migrations.mjs list` |

## Migrations do release, na ordem

Todas são de privilégio (GRANT/REVOKE) e comentário; **nenhuma altera
dados, RLS, funções ou tabelas**. A homologação de rollout aplica exatamente
esta sequência sobre uma réplica no estado da produção, com dados.

| # | Versão | Efeito | Compensação (só com GO, como nova migration) |
| --- | --- | --- | --- |
| 1 | `20261027150000_cart_product_read_grant` | service_role lê `products` → carrinho volta a funcionar | `revoke select on public.products from service_role;` (carrinho volta a falhar) |
| 2 | `20261107120000_order_confirmation_service_role_only` | RPC da confirmação sai de anon e vai para service_role | `grant execute on function public.get_order_confirmation(uuid, uuid) to anon;` (reabre exposição) |
| 3 | `20261107121000_anon_minimal_column_privileges` | anon só lê colunas da vitrine; sem DML anônimo | `grant select on public.tenants, public.tenant_domains to anon;` (reabre PIX/endereço) |
| 4 | `20261107122000_team_invite_service_role_grants` | convite de equipe funciona | `revoke insert, select on public.tenant_members from service_role; revoke select on public.roles from service_role;` |
| 5 | `20261107123000_team_management_authenticated_grants` | troca de função (só `role_id`) e remoção funcionam | `revoke update (role_id), delete on public.tenant_members from authenticated;` |

Compatibilidade de ordem: o código candidato funciona **antes e depois** de
cada migration (confirmação cai para o contrato antigo só em `42501`; PIX e
endereço já são lidos com service_role, que tem SELECT em `tenants`).
Ainda assim, o roteiro aplica migrations **antes** de promover o código para
que a janela de exposição termine junto com o deploy.

## Gates antes de pedir o GO técnico

1. CI e homologação de rollout **verdes no SHA integral** do candidato;
   `main` inalterada desde `da1ab1d` (senão refazer merge-tree e CI).
2. 🔒 Backup externo cifrado **da produção tirado na própria janela**, com
   readback íntegro e critérios de [backup-recovery.md](backup-recovery.md#critérios-verificáveis-de-aceite).
   O piloto de restore aceito é gate de **beta**; para o hotfix, exigir no
   mínimo o export + readback da janela (o free plan não tem PITR nem backup
   diário da plataforma — não há outro ponto de retorno de dados).
3. Lista remota de migrations imediatamente antes da janela: exatamente
   123, última `20261026210716`. Qualquer diferença → interromper.
4. Chaves modernas configuradas e testadas conforme
   [credentials-and-payments.md](credentials-and-payments.md); Preview já
   separado de Produção (sem `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY`
   de produção no alvo Preview).
5. Registro da janela: operador, horário, deployment atual e candidato,
   critérios de interrupção abaixo e GO explícito.

## Roteiro de publicação (ordem exata, após GO)

1. 🔒 Congelar: desligar merges na `main` fora do operador; anotar
   deployment atual (`dpl_AJnRSLMhKw959n5DtwtemJ52ZkJ1`) como rollback.
2. 🔒 Backup da janela (gate 2). Sem bundle íntegro, **parar**.
3. 🔒 Conferir migrations remotas (gate 3).
4. 🔒 Aplicar as 5 migrations **somente** pelo mecanismo com histórico
   (`supabase db push` vinculado ao projeto, após `--dry-run` mostrar
   exatamente as 5, nesta ordem). Nunca `reset`, seed ou SQL avulso.
5. Verificar privilégios (SQL somente leitura do checklist "pós-migration"
   abaixo). Divergência → interromper e decidir compensação.
6. 🔒 Configurar na Vercel Production `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e
   `SUPABASE_SECRET_KEY` (valores direto do painel Supabase para o cofre da
   Vercel, nunca por chat/commit). As legadas permanecem até o passo 10.
7. 🔒 Merge do PR #3 na `main` (dispara o build de produção). Conferir que o
   deployment promovido tem o **SHA candidato**; READY não basta.
8. Smoke de produção (abaixo), com o escopo sintético aprovado.
9. Observar 30 min: runtime errors, cron (deve parar de falhar sem MP
   configurado), Sentry sanitizado.
10. 🔒 Revogação das chaves legadas (seção própria) e probe after-revoke.

## Smoke de produção pós-deploy

Leitura (sem dados novos): home, `/loja/superbrands` com 4 produtos,
produto com variantes, `/api/health`, painel sem sessão → login, cron sem
token → 401, `/loja/superbrands/pedido/<uuid>` sem prova → "não encontrado".

Com escopo sintético aprovado (loja e conta de teste do proprietário, nunca
clientes reais): adicionar ao carrinho e **ver o item após reload**;
checkout WhatsApp até a confirmação; confirmação abre só com o link
recebido; URL sem `?acesso=` → "não encontrado"; cancelar o pedido sintético
e conferir devolução única do estoque; convidar, trocar função e remover um
membro sintético.

Probes de exposição (chave pública, sem sessão):
`POST /rest/v1/rpc/get_order_confirmation` → 401/403;
`GET /rest/v1/tenants?select=pix_key` → 401/403;
`GET /rest/v1/tenants?select=name,slug` → 200.

## Critérios de interrupção

Interromper e não seguir para o próximo passo se ocorrer qualquer um:
- migration remota diferente do esperado, ou `db push --dry-run` com algo
  além das 5 migrations;
- backup da janela incompleto ou readback divergente;
- deployment promovido com SHA diferente do candidato;
- carrinho vazio após adicionar, divergência de total/estoque, pedido
  duplicado, acesso cruzado entre lojas;
- chave pública lendo PIX, endereço ou pedido após as migrations;
- erro de autenticação/sessão generalizado, ou taxa de erro de runtime
  acima da linha de base de antes da janela;
- qualquer chamada a provedor externo (Mercado Pago, Asaas, e-mail) fora do
  escopo aprovado.

## Rollback

- **Código, antes da revogação**: promover de volta `dpl_AJnRSLMhKw959n5DtwtemJ52ZkJ1`.
  As migrations 1, 4 e 5 podem permanecer. O código antigo lê confirmação,
  PIX e endereço de retirada **com a chave pública**; com as migrations 2 e 3
  aplicadas, essas três telas deixam de funcionar. Decidir na hora, com GO:
  manter (loja sem confirmação/PIX/retirada até corrigir o candidato) ou
  aplicar as compensações 2 e 3 (reabre a exposição). Preferir corrigir e
  republicar o candidato.
- **Código, depois da revogação**: o deployment antigo usa as chaves legadas
  e **não serve**; o rollback é um build do SHA anterior com chaves modernas,
  preparado antes da revogação.
- **Banco**: compensações por migration na tabela acima, sempre como nova
  migration com GO. Restore de dados só para perda/corrupção, pelo
  procedimento de backup-recovery.md — nunca para falha visual.

## Troca e revogação das chaves antigas

Detalhes e probes em [supabase-key-rotation.md](supabase-key-rotation.md).
Resumo após o passo 9 estável:
1. 🔒 Confirmar que nenhum consumidor usa o JWT legado (Vercel Production e
   Preview, jobs, automações; Edge Functions: zero em 05/11).
2. 🔒 Desativar no painel Supabase as API keys legadas `anon` e `service_role`.
3. Probe `scripts/operations/verify-key-cutover.mjs` modo after-revoke:
   publishable lê catálogo, não lê carrinho; secret lê carrinho; **ambas as
   legadas 401**. Repetir smoke de leitura e login.
4. Remover os nomes legados da Vercel e rebuild. Registrar IDs e horários,
   nunca valores.
