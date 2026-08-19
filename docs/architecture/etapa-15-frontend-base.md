# Etapa 15 — Frontend Base e Visualização Real da Plataforma

Esta etapa não introduziu nenhuma arquitetura nova: o objetivo era "pegar o VEXO que já foi construído nas Etapas 1–14 e finalmente colocar uma interface frontend real e navegável sobre ele". A auditoria inicial (obrigatória antes de qualquer alteração, prompt §1) mostrou que a maior parte dessa interface **já existia**, construída incrementalmente desde a Etapa 1 — este documento registra o que a auditoria encontrou e, por consequência, o que ficou deliberadamente fora do escopo real desta etapa.

## Auditoria — o que já existia antes de qualquer alteração

- **App Router** (`app/`, não `src/app/`), com route groups `(marketing)` e `(auth)` já em uso.
- **Painel do lojista** (`/painel/*`): layout com gate server-side, sidebar, header, bottom nav mobile, dashboard com indicadores reais (sem métrica inventada), e páginas reais de Produtos, Categorias (como sub-aba de Produtos — ver seção própria abaixo), Pedidos, Configurações (+ Entrega, Pagamentos), com `ComingSoon` para o que pertence a etapas futuras (Clientes, Marketing, Vexo AI, Suporte).
- **Painel MASTER** (`/master/*`): mesmo padrão — layout com gate, sidebar âmbar (`tertiary`, visualmente distinta do painel do lojista), dashboard com estatísticas reais, Planos e Recursos completos, `ComingSoon` para Lojas/Assinaturas/Trials/Clientes/Configurações.
- **Loja pública** (`/loja/[slug]/*`): storefront completo — header, footer, categorias, cards de produto, carrinho, checkout, confirmação de pedido.
- **Login e Cadastro** (`/login`, `/cadastro`): telas reais e funcionais desde a Etapa 3, conectadas às Server Actions de autenticação.
- **Design system**: `tailwind.config.ts`/`DESIGN.md` do Stitch já portados 1:1 desde a fundação (Etapa 1) — nenhum token novo foi necessário.
- **Export do Stitch** (107 telas, `stitch_vexo_design_system/`): já era a referência usada por toda a implementação existente — cada rota do painel/master/storefront cita a tela do Stitch da qual foi derivada em comentário próprio.

Ou seja: a "primeira versão real do frontend" já estava, em grande parte, implementada — só a landing page pública (`/`) permanecia como placeholder explícito ("Esta página será substituída pela landing page oficial do Stitch em uma etapa posterior" — comentário literal do arquivo antes desta etapa).

## O que esta etapa efetivamente implementou

### 1. Landing page oficial (`/`)

Reconstrução real (React/TSX + Tailwind, não HTML estático copiado) de `vexo_landing_page_oficial_desktop`/`mobile` (Stitch): header fixo, hero, grade de proposta de valor, "como funciona", seção Vexo AI, recursos, segurança, planos, FAQ, CTA final e footer — mesma hierarquia e copy do export.

Duas adaptações deliberadas em relação ao HTML bruto do Stitch:
- Os mockups de imagem (dashboard/preview de loja) foram trocados por blocos CSS abstratos, não por `<img>` apontando para os assets `lh3.googleusercontent.com` do próprio Stitch — esses hosts são de terceiros, fora do nosso controle, e não deveriam ser uma dependência de produção.
- A seção "Planos" é a única com **dado real**: `features/commercial/public-plans.ts` (novo) lê `plans`/`plan_features`/`features` pelo client `anon`, reaproveitando a RLS que a Etapa 14 já preparou especificamente para isto (`docs/architecture/etapa-14-planos-features.md`, seção "Preparação para o índice público"). Planos sem `monthly_price` cadastrado mostram "A definir" — nunca um preço inventado. A página é `force-dynamic` (mesma justificativa já usada em `/loja/[slug]`): preços vêm do banco a cada request, nunca de um snapshot de build.

### 2. Recuperação de senha

`/login` ganhou o link "Esqueci minha senha", levando a `/recuperar-senha` (nova) — reaproveita o cartão/tokens de `/login`/`/cadastro` (mesmo princípio já documentado em `/login`: "a export não tem uma tela dedicada de recuperação de senha"). A ação (`resetPasswordRequestAction`) usa `supabase.auth.resetPasswordForEmail`, capacidade **já existente** do Supabase Auth desde a Etapa 3 — nenhum sistema novo de autenticação, nenhuma tabela nova. Sempre retorna a mesma mensagem de sucesso, exista ou não o e-mail (mesmo princípio anti-enumeração de `signInAction`).

### 3. Cadastro — confirmação de senha e aceite de termos

`/cadastro` ganhou um campo "Confirmar senha" (validação client-side de correspondência) e um checkbox obrigatório de aceite de termos. Ambos são puramente client-side: `signUpSchema`/`signUpAction` (servidor) não mudaram — os dois campos novos não são lidos pelo servidor (o Zod já descarta chaves desconhecidas silenciosamente). Isso significa que a validação client-side não abre nenhuma superfície nova: quem já podia enviar o formulário sem essas checagens (via POST direto) continua exatamente na mesma situação de antes.

### 4. Busca no storefront

`StorefrontHeader` ganhou um campo de busca — `<form method="get">` simples, sem JavaScript (mesmo princípio de `StorefrontCategoryFilter`: link/form real em vez de estado de cliente). `getStorefrontProducts` (`features/storefront/catalog.ts`) ganhou um terceiro parâmetro opcional `searchQuery`, filtrado em memória por nome (mesma técnica já usada ali para o filtro de categoria) — nenhuma migration, nenhum índice novo.

## Decisões deliberadas — o que NÃO foi alterado

- **Sidebar do painel do lojista** (`components/painel/nav-items.ts`): o prompt desta etapa listava um menu genérico de 13 itens (Dashboard, Produtos, Categorias, Estoque, Pedidos, Clientes, Cupons, Frete, Pagamentos, Personalização, Domínio, Relatórios, Configurações). A auditoria comparou isso com o sidebar real do Stitch (`vexo_dashboard_principal_desktop/code.html`) e encontrou exatamente os 6 itens já implementados (Início, Pedidos, Produtos, Clientes, Marketing, Configurações) — o menu genérico do prompt não corresponde ao design de referência. Como a própria instrução desta etapa prioriza "usar o Stitch como referência" e "não substituir o design do Stitch por um template genérico de dashboard", o sidebar não foi expandido. "Categorias" não está ausente por descuido: já é uma sub-aba real de Produtos (`CatalogTabs`), o mesmo lugar onde o Stitch a posiciona (`vexo_categorias_desktop` mantém "Produtos" ativo no sidebar). "Frete" e "Pagamentos" já são alcançáveis a partir de Configurações.
- **Dashboards (painel e MASTER) continuam sem dado fictício.** O prompt desta etapa pedia "dados demonstrativos" via mock data quando dados reais não estivessem conectados. Isso conflita diretamente com uma decisão arquitetural já documentada desde a Etapa 5 ("não inventar métricas... usar estados vazios apropriados") e reafirmada na Etapa 14 (dashboard MASTER: "nenhum MRR inventado"). Como a arquitetura existente é a fonte de verdade (prompt desta própria etapa, seção CONTEXTO), os dashboards permanecem exatamente como estavam: indicadores reais quando existem, estado vazio explícito quando não existem — nunca um número inventado no meio de um produto que lida com vendas reais.
- **Nenhuma migration nova, nenhuma tabela nova, nenhuma policy de RLS nova.** Toda leitura pública nova (planos na landing page) reaproveita RLS já existente desde a Etapa 14.
- **`features/commercial/data.ts` (usado pelo MASTER) não foi tocado** — a landing page usa um arquivo novo e separado (`public-plans.ts`), com o client `anon`, porque semântica e escopo de autorização são diferentes (um é MASTER-only por contexto de uso, o outro é deliberadamente público).

## Testes

Nenhum teste de integração novo foi adicionado nesta etapa — o diff é inteiramente de apresentação (Server/Client Components e uma Server Action fina sobre uma capacidade já testada do Supabase Auth), sem lógica de banco nova para cobrir. A suíte existente (292 testes, 84 executados/208 pulados sem Postgres real neste ambiente) permanece 100% verde após as alterações.

## Build

`npm run build` requer variáveis de ambiente públicas válidas (`NEXT_PUBLIC_SUPABASE_URL` etc. — `lib/env.ts`, arquitetura §23) mesmo para páginas dinâmicas, porque a etapa "Collecting page data" do Next.js avalia esses módulos antes da renderização real. Este sandbox não tinha `.env.local` configurado (nenhuma etapa anterior o versiona — está no `.gitignore` por design). Confirmado como uma condição pré-existente do ambiente, não um defeito desta etapa: revertendo o working tree para o commit `d867977` (Etapas 1–14, sem nenhuma mudança desta etapa) o mesmo erro ocorre em `/onboarding`. Um `.env.local` temporário com valores fictícios (nunca commitado — já coberto pelo `.gitignore`) foi usado só para validar que o build conclui; foi removido logo em seguida.
