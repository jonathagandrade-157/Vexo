# Etapa 6 — Storefront / Loja Online Base

> Documentação curta desta etapa. Para o desenho completo ver
> `docs/architecture/vexo-arquitetura-tecnica.md` (§6, §25) e
> `docs/architecture/etapa-5-painel-lojista.md` (base sobre a qual esta
> etapa é construída, sem alterações de comportamento).

## Fluxo completo

```
/loja/[slug]  (rota pública, path-based)
  → slug não existe                              → Estado 1: "Loja não encontrada"
  → slug existe, status suspended/deleted          → tratado igual ao Estado 1
  → slug existe, onboarding_completed_at IS NULL   → Estado 2: "ainda sendo configurada"
  → slug existe, onboarding concluído              → Estado 3: storefront completo
```

Nenhuma mudança em `proxy.ts` — a resolução por path (Next.js) não
precisa de nenhum roteamento especial. `features/storefront/resolve-tenant.ts`
é o único ponto de resolução (slug → tenant), isolado exatamente para que
uma etapa futura de domínio/subdomínio (`loja.vexo.com` ou domínio
próprio) chame essa mesma função a partir de um `proxy.ts` que reescreve
o host para o path — sem duplicar a regra.

## Telas do Stitch — usadas só como estrutura, não como conteúdo

`vexo_storefront_home_desktop`/`_auditado` são um mockup de e-commerce de
moda 100% fictício (foto de moda gerada, "Nova Coleção", categorias
Masculino/Feminino/Perfumes/Kits, contadores de carrinho/wishlist, nav
para Products/Categories/Offers, newsletter, footer com
Privacy/Terms/FAQ/Rastrear Pedido). Nada disso existe no produto ainda —
reaproveitado só o **padrão estrutural** (header fixo com blur, footer em
grid, hero centralizado) e o padrão visual de estado vazio de
`vexo_estados_do_sistema_desktop` (ícone em círculo + headline + body —
o mesmo já usado em `components/painel/coming-soon.tsx`, Etapa 5). Não
usadas: `vexo_storefront_categoria_desktop`, `_produto_desktop`,
`_carrinho_desktop` (dependem de produto/carrinho), `vexo_trial_encerrado_estado`,
`vexo_estados_de_clientes_desktop` (não são do storefront).

## Dados reais exibidos

`tenants.{name,slug,segment,description,instagram_handle,whatsapp_phone,contact_email}`
— os mesmos 6 campos de identidade da Etapa 4, sem duplicar em tabela
nova. `created_by` e `onboarding_completed_at` nunca saem da projeção
pública (`features/storefront/resolve-tenant.ts` nomeia as colunas
explicitamente, nunca `select *`).

## Migration (1, incremental) — e a correção que ela exigiu

Nova policy de SELECT em `tenants`, só para `anon`:

```sql
create policy "anyone can view public storefront-visible tenants"
  on public.tenants for select
  to anon
  using (status not in ('suspended', 'deleted'));
```

`status not in ('suspended', 'deleted')`, não `status = 'active'`: hoje
todo tenant fica em `pending` (não existe fluxo de aprovação MASTER
ainda) — gatear em `active` tornaria toda loja real invisível
publicamente. `onboarding_completed_at` (não `status`) é quem decide
Estado 2 vs. Estado 3.

**Encontrado e corrigido durante esta etapa** (não só documentado): a
primeira versão da policy cobria `to anon, authenticated`, com o
raciocínio de "um visitante logado também precisa ver o storefront de um
tenant do qual não é membro". Rodar a suíte completa revelou que isso
quebrava **6 testes de isolamento** das Etapas 2, 4 e 5
(`rls-isolation`/`onboarding`/`painel.test.ts`) — RLS não distingue "esta
query é do storefront público" de qualquer outra query em `tenants`;
cobrir `authenticated` valia para TODO uso autenticado da tabela
(painel incluído), afrouxando o isolamento entre tenants além do
pretendido. Corrigido removendo `authenticated` da policy — o
storefront nunca precisou dele: `createSupabasePublicClient()` (abaixo)
nunca lê cookie de sessão, então toda chamada dele autentica como `anon`
no Supabase, mesmo que o visitante esteja logado em outra aba. Os 6
testes antigos foram atualizados (não revertidos) para refletir a nova
regra pretendida — `anon` lendo `tenants` não suspensos passou a ser
esperado, exatamente o objetivo desta etapa.

## Cliente Supabase novo: `createSupabasePublicClient()`

Terceiro cliente em `lib/supabase/server.ts` (além do ligado à sessão e
do service-role) — anon key, sem `cookies()`. Existe por dois motivos:
segurança (a rota nunca precisa/deve saber quem está de sessão em outra
aba) e performance (usar o cliente ligado à sessão forçaria a rota
inteira a ser dinâmica pela API `cookies()` do Next.js, impedindo o ISR).

## Cache / revalidação

`export const revalidate = 60` em `/loja/[slug]`. Escolha simples, sem
infraestrutura de invalidação sob demanda: uma edição em
`/painel/configuracoes` aparece no storefront em até 60 segundos. O
Next.js cacheia por path completo (`/loja/tenant-a` e `/loja/tenant-b`
são entradas de cache independentes) — não há mistura entre tenants por
construção, não por código adicional. `resolveStorefrontTenant` é
memoizado com `cache()` do React só dentro do mesmo request, para
`generateMetadata` e a página não repetirem a mesma consulta (arquitetura
§18).

## Componentes criados

`StorefrontShell`, `StorefrontHeader` (só nome da loja — sem busca/conta/
carrinho, nada disso existe ainda), `StorefrontFooter`, `StorefrontBrand`
(hero: nome/segmento/descrição, sem imagem de fundo — não existe upload
de logo ainda), `StorefrontContact` (Instagram/WhatsApp/e-mail, cada um
só se preenchido), `StorefrontEmptyState` (reaproveita o padrão visual do
`ComingSoon`, Etapa 5), `StorefrontNotFound`.

## SEO

`generateMetadata` dinâmica: title/description reais, OpenGraph básico,
`canonical` via `NEXT_PUBLIC_SITE_URL` (env já existente desde a Etapa
1). Estados 1 e 2 marcados `robots: { index: false }` — não indexar loja
inexistente/não configurada.

## Segurança

Nenhuma proteção das Etapas 2–5 foi alterada ou removida — só uma policy
nova, aditiva. `audit_logs`, `roles`, `permissions`, `tenant_members`,
`profiles` (onde mora `cpf_hash`) continuam sem nenhuma policy para
`anon`, testado explicitamente nesta etapa. Sem enumeração possível: não
existe endpoint de listagem/busca de tenants, só resolução direta por
slug (é preciso já saber o slug, o mesmo modelo de qualquer URL própria).

## Limitações

- Testado contra Postgres real + stub, não Supabase real — mesma
  ressalva de sempre.
- Renderização visual (desktop/mobile/estados) verificada por build +
  revisão de código, não por teste E2E/HTTP — sem servidor Next.js
  rodando no harness de integração.
- `next build` mostra `/loja/[slug]` como rota dinâmica (ƒ), não com
  anotação de ISR — esperado: o build usa variáveis de ambiente
  placeholder (sem Supabase real), então o Next não consegue pré-renderizar
  nada de fato; `export const revalidate = 60` passa a valer em runtime
  contra um backend real.

## Funcionalidades deliberadamente não implementadas

Produtos, categorias, estoque, carrinho, checkout, pedidos, clientes,
pagamentos/gateways, frete, domínio personalizado, assinatura paga,
cupons, avaliações, wishlist, painel MASTER, relatórios, Google
Analytics, Meta Pixel, IA, API pública, editor de temas — todas fora do
escopo por instrução explícita.
