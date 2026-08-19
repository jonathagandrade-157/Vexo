# Etapa 7 — Catálogo: Produtos e Categorias

> Documentação curta desta etapa. Para o desenho completo ver
> `docs/architecture/vexo-arquitetura-tecnica.md` (§6, §9, §25) e
> `docs/architecture/etapa-6-storefront.md` (base sobre a qual esta etapa
> é construída, sem alterações de comportamento).

## Fluxo de categorias

```
/painel/produtos  (aba "Categorias")  →  /painel/categorias
  → "Nova categoria" / ícone de editar → modal CategoryFormDialog (create/edit)
  → ícone de excluir → ConfirmDialog → bloqueado pelo próprio banco (FK)
    se a categoria tiver produtos vinculados
  → ícone de liga/desliga → toggleCategoryStatusAction
```

Sem hierarquia pai/filho: `vexo_categorias_desktop` (Stitch) mostra uma
árvore com drag-and-drop, mas isso não está nos campos aprovados
(`id, tenant_id, name, slug, description, status, sort_order,
created_at, updated_at`) nem foi pedido — reaproveitado só o padrão
visual da linha (ícone, nome, contagem de produtos, status, ações).
Categorias não têm rota própria no sidebar principal — o próprio Stitch
mantém "Produtos" destacado na tela de categorias, ou seja, é uma
sub-seção de Produtos, não uma seção irmã (`CatalogTabs`).

## Fluxo de produtos

```
/painel/produtos  → tabela (desktop) / cards (mobile)
  → "Adicionar produto" → /painel/produtos/novo (página dedicada,
    igual ao padrão "Voltar" de vexo_adicionar_produto_desktop)
  → ícone de editar → /painel/produtos/[id]/editar
  → ícone de liga/desliga → toggleProductStatusAction
  → ícone de excluir → ConfirmDialog → hard delete real
```

Categorias usam modal (CRUD simples, poucos campos); produtos usam
página dedicada (formulário maior, mesmo padrão do Stitch). Diferença
deliberada, não inconsistência.

## Dados coletados

Categoria: nome, descrição (opcional). Produto: nome, descrição
(opcional), preço, preço promocional (opcional, ≤ preço), SKU
(opcional), categoria (opcional). Slug gerado no servidor via
`lib/utils/slugify.ts` (reaproveitado, não duplicado) — sem campo de
slug no formulário porque nenhuma tela do Stitch mostra um.

## Tabelas novas

- `categories` (`id, tenant_id, name, slug, description, status,
  sort_order, created_at, updated_at`) — `unique (tenant_id, slug)`,
  `check` de formato de slug, `status in ('active','inactive')`.
- `products` (`id, tenant_id, category_id, name, slug, description,
  price, promotional_price, sku, status, main_image, created_at,
  updated_at`) — `price`/`promotional_price` em `numeric(10,2)` (nunca
  float), `check (promotional_price is null or promotional_price <=
  price)`, `unique (tenant_id, slug)`.

Sem variantes de produto (tamanho/cor) — decisão explícita do prompt
desta etapa, registrada aqui como pendente para uma etapa futura que a
aprove formalmente. Sem controle de estoque (`stock_quantity` e
similares) — pertence à etapa de pedidos/estoque.

## Migrations (5, incrementais)

`categories` + `products` (com `set_updated_at`/`prevent_tenant_id_change`
reaproveitados da Etapa 2) → permissões `categories.{view,create,update,delete}`
(novas — não existiam; mesma matriz de papéis que `products.*` já tinha:
OWNER/ADMIN/MANAGER com CRUD completo, OPERATOR/SUPPORT sem acesso) →
RLS de escrita (`has_permission`, mesmo padrão de `tenants`/`settings.update`)
+ RLS pública **só para `anon`** (nunca `authenticated` — ver "Segurança"
abaixo) → extensão do trigger de auditoria existente com
CATEGORY_CREATED/UPDATED/DELETED e PRODUCT_CREATED/UPDATED/DELETED/
STATUS_CHANGED.

**Proteção "produto do tenant A + categoria do tenant B"**: uma FK simples
em `products.category_id` não bastaria (garante que o id existe em
`categories`, não que pertence ao mesmo tenant) — um trigger
`private.prevent_cross_tenant_category()` fecha essa lacuna, testado
explicitamente.

**"Categoria com produtos não pode gerar produtos órfãos"**: resolvido
pelo comportamento padrão do Postgres, sem trigger nenhum — `category_id`
não tem `on delete cascade`/`on delete set null`, então o padrão (`NO
ACTION`) já rejeita a exclusão de uma categoria referenciada, com
`23503`. A Server Action traduz isso numa mensagem clara.

## Segurança — a lição da Etapa 6, aplicada desde o início

A policy pública de leitura (`anyone can view active products/categories
of publicly visible tenants`) cobre **só `to anon`**, nunca
`authenticated` — exatamente a correção que a Etapa 6 precisou fazer
depois de quebrar 6 testes (cobrir `authenticated` alarga a visibilidade
para QUALQUER uso autenticado da tabela, não só o storefront, porque RLS
não distingue de onde a query vem). Desta vez aplicada corretamente já na
primeira versão da migration — confirmado por um teste dedicado
("an authenticated user without membership gets zero rows, never the
anon-only public view").

Revisão completa contra os 18 itens do checklist do prompt (§22) — nenhuma
vulnerabilidade nova encontrada além do padrão já resolvido acima.
`dangerouslySetInnerHTML`, uso de `service_role` e SQL concatenado
verificados ausentes em todo o código novo desta etapa (checagem
explícita via grep, não só inspeção visual).

## Imagens — fundação apenas

`products.main_image` (texto, nullable — vai guardar um path de Storage).
**Sem upload real nesta etapa**: `supabase/config.toml` não tem bucket
configurado (`# [storage.buckets.images]` continua comentado), e não há
como validar Storage real neste ambiente (mesma limitação de sempre —
Docker bloqueado). O card "Mídia" do formulário de produto mostra
"Upload de imagens estará disponível quando o armazenamento de arquivos
for configurado" em vez de simular um dropzone que não funciona de
verdade. A arquitetura de Storage (bucket por tenant, path gerado no
servidor, policy derivando tenant do path) já está descrita em
`vexo-arquitetura-tecnica.md` §9 — não redesenhada aqui, só referenciada
para quando puder ser implementada e validada de verdade.

## Integração com o storefront

`/loja/[slug]` passa a mostrar categorias reais (filtro por
`?categoria=slug`, links reais, não checkboxes com estado de cliente) e
produtos reais (grid de cards, preço com promocional riscado quando
houver). Nova rota `/loja/[slug]/produto/[productSlug]` — página de
produto real, sem "adicionar ao carrinho"/comprar. Todas as consultas via
`createSupabasePublicClient()` (Etapa 6) — nunca o cliente ligado à
sessão.

`resolveStorefrontTenant` passou a incluir `tenant.id` (Etapa 6 não
incluía) — necessário para consultar `categories`/`products`, que têm
`tenant_id`, não slug. Não é dado sensível (UUID aleatório, não
sequencial); a garantia real de "não expor dado administrativo" é nunca
renderizar isso em HTML/props de Client Component, não nunca buscá-lo —
`created_by`/`onboarding_completed_at` continuam de fora da projeção
pública, esses sim dados administrativos.

**Nuance de cache**: a home do storefront agora lê `searchParams`
(`?categoria=`), o que o Next.js trata como API dinâmica — a página base
(sem filtro) continua elegível ao `revalidate = 60` (Etapa 6), mas uma
navegação com `?categoria=` é servida dinamicamente a cada request, não
cacheada por 60s. Aceito: cardinalidade baixa (poucas categorias por
loja), sem necessidade de infraestrutura de cache por variante de query
string nesta etapa.

## Testes

`tests/integration/catalog.test.ts` — 20 cenários cobrindo os 30 itens
pedidos no prompt (vários itens mapeiam ao mesmo teste, ex.: RLS entre
tenants cobre categoria e produto na mesma asserção). Um teste revelou
uma suposição errada minha (não um bug): esperava que um usuário
autenticado sem membership visse os mesmos dados públicos que `anon` veria
usando a mesma query — na verdade ele vê **zero linhas**, porque a policy
pública é `anon`-only. Corrigido o teste, não o código — esse é
exatamente o comportamento correto e pretendido.

**Total da suíte: 120/120 testes passando** (100 anteriores + 20 novos).

## Limitações

- Postgres real + stub, não Supabase real — mesma ressalva de sempre.
- Sem upload de imagem real (ver "Imagens" acima).
- Renderização visual (desktop/mobile/estados) verificada por build +
  revisão de código, não por teste E2E/HTTP.

## Decisões pendentes

- Variantes de produto (tamanho/cor) — explicitamente fora desta etapa,
  aguardando aprovação de modelo numa etapa futura.
- Bucket de Storage para imagens de produto — aguardando poder ser
  configurado e validado contra Supabase real.

## Funcionalidades deliberadamente não implementadas

Carrinho, wishlist, checkout, pedidos, clientes, pagamentos/gateways,
assinatura/cobrança, frete, cupons, avaliações, marketplace, domínio
personalizado, painel MASTER, relatórios avançados, IA, API pública —
todas fora do escopo por instrução explícita.
