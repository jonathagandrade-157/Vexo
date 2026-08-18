# Etapa 5 — Painel Administrativo do Lojista (fundação)

> Documentação curta desta etapa. Para o desenho completo ver
> `docs/architecture/vexo-arquitetura-tecnica.md` (§6, §8, §25) e
> `docs/architecture/etapa-4-onboarding.md` (base sobre a qual esta etapa
> é construída, sem alterações de comportamento).

## Fluxo completo

```
/trial/sucesso → /onboarding → (concluído) → /painel

app/painel/layout.tsx  (gate único, aplica a TODAS as rotas /painel/*)
  → sem sessão                              → /login
  → sem tenant nenhum (sem membership)       → /sem-loja
  → tenant pendente, usuário é o OWNER       → /onboarding
  → tenant pendente, usuário NÃO é o OWNER   → estado informativo inerte
  → tenant com onboarding concluído          → shell (sidebar + header + conteúdo)

/painel                → Início (estado vazio real + indicadores reais)
/painel/configuracoes  → Minha Loja (editar dados da Etapa 4)
/painel/{pedidos,produtos,clientes,marketing,suporte,vexo-ai,assinatura}
                        → "disponível em breve" (rota real, sem funcionalidade)
```

## Telas do Stitch usadas

- `vexo_dashboard_comece_a_vender_desktop` — base do Início: é a versão de
  **estado vazio real** (não `vexo_dashboard_principal_*`, que tem
  vendas/pedidos/clientes 100% fictícios — não usada para dados, só para
  extrair a estrutura de sidebar/header/nav mobile).
- `vexo_dashboard_status_do_trial_desktop` — banner de trial, adaptado com
  dado real (mesmo padrão de conteúdo já usado em `/trial/sucesso`,
  Etapa 3: "Plano: Teste" em vez de "PRO").
- `vexo_configura_es_gerais_desktop` — só a seção "Minha Loja" (os 6
  campos da Etapa 4). A seção "Minha Conta" (nome/e-mail pessoal, senha,
  2FA) e os campos CNPJ/CPF/Endereço (que não existem no schema) ficam de
  fora — não são dados da Etapa 4 e não foram pedidos explicitamente.

Não usadas nem inventadas: produtos, pedidos, clientes, marketing,
checkout, pagamentos, frete, equipe/domínio, planos/assinatura, telas
MASTER, relatórios, IA, storefront público.

## Gate do painel (`app/painel/layout.tsx`)

Único ponto de decisão para todas as rotas `/painel/*` — Next.js aplica um
layout a toda a árvore de rotas abaixo dele automaticamente, então nenhuma
página sob `/painel` precisa duplicar a checagem (proteção contra "acesso
direto por URL" é estrutural, não um hábito a lembrar em cada página nova).

Tenant sempre resolvido a partir da sessão via `resolveActiveTenantForUser`
(`features/onboarding/resolve-tenant.ts`, estendido nesta etapa — mesma
consulta compartilhada que `resolveOnboardingTenant` já usava, agora
reconhecendo **qualquer papel ativo**, não só OWNER, porque ADMIN/MANAGER/
OPERATOR/SUPPORT também acessam o painel). `getCurrentMembership`
(`features/painel/current-tenant.ts`) usa `cache()` do React para não
repetir essa consulta entre o layout e cada página.

## Novo caso tratado: onboarding pendente, mas o usuário não é o OWNER

Cenário defensivo (não alcançável no fluxo atual, já que não há convite de
equipe ainda, mas testável via SQL direto): um ADMIN/MANAGER/etc. de um
tenant cujo OWNER ainda não concluiu o onboarding. Mandar essa pessoa para
`/onboarding` seria inútil (ela não é OWNER, `resolveOnboardingTenant`
rejeitaria) — em vez de um redirect que não leva a lugar nenhum, o layout
mostra um estado informativo inerte ("a loja ainda está sendo
configurada").

## Migrations (2, incrementais)

- `public.has_permission(p_tenant_id, p_permission_key)` — wrapper fino
  sobre `private.has_permission()` (Etapa 2); existe só porque Server
  Actions do Next.js chamam RPC via PostgREST, que só expõe funções de
  `public`, não de `private`. Não duplica a checagem, só a expõe.
- Estende (mais uma vez) `private.audit_tenant_changes()` (0010, já
  estendido em 0019) com `TENANT_SETTINGS_UPDATED`, disparado quando os
  campos de perfil da loja mudam **depois** de o onboarding já estar
  concluído — a transição de conclusão continua tendo seu próprio evento
  (`TENANT_ONBOARDING_COMPLETED`), testado que os dois nunca disparam
  juntos na mesma gravação.

Nenhuma tabela nova, nenhuma coluna nova, nenhuma policy de RLS nova — a
policy de UPDATE de `tenants` (Etapa 2, `settings.update`) já cobre a
edição pós-onboarding.

## Permissões

Mesma matriz da Etapa 2 (`role_permissions`), sem alteração: `settings.update`
→ OWNER e ADMIN. `updateStoreProfileAction` checa isso explicitamente via
`public.has_permission()` antes do UPDATE (mensagem de erro clara em vez
de deixar a RLS falhar silenciosamente) — RLS continua sendo a autoridade
final, essa checagem é defesa em profundidade, não substituição.
`/painel/configuracoes` mostra o formulário **desabilitado** (sem botão de
salvar) para quem não tem a permissão, mas a autorização real nunca é
decidida no client.

## Indicadores do Dashboard — só dados reais

`tenants.status` (traduzido), dias restantes de `trial_records`, segmento
(Etapa 4), contagem de `tenant_members` ativos — os quatro únicos
indicadores mostrados, todos derivados de tabelas que já existem. Nenhum
gráfico, nenhuma métrica de vendas/pedidos/visitas/conversão (essas telas
do Stitch usam dados 100% inventados, não usadas para isso). O card
"Comece a vender" (estado vazio real do Stitch) substitui qualquer
métrica que ainda não existe de verdade.

## Navegação — itens de etapa futura

`components/painel/nav-items.ts` marca cada item com `implemented`. Os
marcados `false` (Pedidos, Produtos, Clientes, Marketing, Vexo AI,
Suporte) são rotas reais (`components/painel/coming-soon.tsx`) — nunca um
link morto (`href="#"`), sempre uma página que funciona após refresh e por
URL direta, só sem a funcionalidade ainda.

## Duas omissões de conteúdo em relação ao mockup (mesmo padrão da Etapa 3)

Header sem barra de busca (não há produtos/pedidos/clientes para buscar
ainda) e sem sino de notificação com indicador de não-lidas (não existe
sistema de notificação nenhum — mostrar o indicador seria inventar dado).
Estrutura e tokens do header continuam os do Stitch; só esses dois
elementos sem função real foram omitidos.

## Bug encontrado e corrigido durante esta etapa

Um export não-função (`initialSignUpState`/`initialSignInState`, objetos
de estado inicial) convivendo com Server Actions no mesmo arquivo
`"use server"` (`features/auth/actions.ts`) quebrava o build assim que um
**Server Component** passou a importar uma dessas actions — Next.js só
aceita funções async exportadas de um módulo `"use server"`, e essa regra
só é validada quando o módulo é avaliado no lado servidor (o que não
acontecia antes, porque só Client Components importavam dali). Corrigido
movendo `signOutAction` para seu próprio arquivo
(`features/auth/sign-out-action.ts`).

## Limitações

- Testado contra Postgres real + stub (mesmo harness das etapas
  anteriores), não Supabase real — mesma ressalva de sempre.
- O gate de redirect do layout (Server Component) é verificado por build +
  revisão de código, não por teste E2E/HTTP — a lógica de resolução de
  tenant que o alimenta (`resolveActiveTenantForUser`) é testada
  diretamente via SQL nos 13 cenários de `tests/integration/painel.test.ts`.

## Funcionalidades deliberadamente não implementadas

Produtos, categorias, estoque, clientes, pedidos, checkout, pagamentos/
gateways, frete, domínio personalizado, assinatura paga/cobrança, painel
MASTER, relatórios avançados, Google Analytics, Meta Pixel, IA,
marketplace, automações avançadas, personalização completa de temas,
edição de perfil pessoal (nome/e-mail/senha/2FA) — todas fora do escopo
por instrução explícita.
