# Etapa 9 — Carrinho e Experiência de Compra

> Documentação curta desta etapa. Para o desenho completo ver
> `docs/architecture/vexo-arquitetura-tecnica.md` (§5, §9, §17, §24 —
> nenhuma tabela de carrinho estava definida ali, só `create_order_from_cart`
> como função *futura* que consumiria um carrinho já existente) e
> `docs/architecture/etapa-8-storage-imagens.md` (base sobre a qual esta
> etapa é construída). Não existe `DESIGN.md` nem um arquivo "CHECKLIST
> MASTER" neste repositório — mesma situação já registrada em etapas
> anteriores; seguida a arquitetura técnica + os tokens/componentes já
> estabelecidos como referência de design.

## Fluxo implementado

```
/loja/[slug]/produto/[slug] → "Adicionar ao carrinho" (funcional, com
  seletor de quantidade) → confirmação inline + contador do header
  atualiza → ícone do carrinho no header → /loja/[slug]/carrinho →
  alterar quantidade (+/-) ou remover por linha → "Limpar carrinho"
  (com confirmação) → resumo (subtotal + qtde total) → "Continuar
  comprando" (volta pra loja) → botão de checkout em estado explícito
  "em breve" (nunca um link morto)
```

## Modelo de dados

Nenhuma estrutura de carrinho existia (confirmado por busca antes de
criar qualquer migration). Duas tabelas novas:

- `carts` (`id, tenant_id, created_at, updated_at`)
- `cart_items` (`id, cart_id, tenant_id, product_id, quantity, created_at, updated_at`,
  `unique (cart_id, product_id)`)

**Sem coluna de preço em `cart_items`** — o preço nunca é armazenado no
carrinho, é sempre derivado ao vivo de `products.price`/`promotional_price`.
Isso não é só uma regra de validação, é uma garantia estrutural: não
existe um preço vindo do cliente para desconfiar, porque não existe
coluna nenhuma para ele preencher (testado explicitamente via
`information_schema.columns`). `tenant_id` denormalizado em `cart_items`
(mesmo padrão de `categories`/`products`). `product_id` com
`on delete cascade` — produto excluído pelo lojista some do carrinho
automaticamente, nunca uma referência quebrada exibida ao visitante. Sem
`customer_id`/`status` especulativos — a arquitetura não fica bloqueada
por isso: adicionar essas colunas quando clientes/checkout existirem é
uma migration incremental trivial, não um redesenho.

## Estratégia de persistência

Cookie **HttpOnly, um por loja** (`vexo_cart_{slug}`), no formato
versionado `v1.<cart_id>.<owner_token>`. O servidor gera tanto o UUID
quanto um segredo aleatório de 256 bits; o banco armazena somente
`SHA-256(owner_token)` em `carts.owner_token_hash`. O UUID identifica o
carrinho, mas nunca é aceito isoladamente como prova de posse.

O cookie usa `Secure` em produção, `SameSite=Lax`, `Path=/` e `maxAge`
de 30 dias. Um cookie por slug evita mistura entre lojas já na camada de
sessão. Cookies legados contendo apenas UUID falham fechados e originam
um carrinho novo; nenhum dado é aberto para preservar compatibilidade.

## Regras de quantidade

Mínimo 1, máximo 99 — valor provisório e documentado como tal (sem
conceito de estoque ainda, não há um limite "real" para derivar; só
evita abuso óbvio). Decrementar até 0 remove a linha
(`updateCartItemQuantityAction` trata `quantity < 1` como remoção).
Validado em duas camadas: Zod no servidor (nunca confiando no cliente) e
`check (quantity > 0 and quantity <= 99)` no banco.

## Regras de preço

`effectivePrice(product) = promotional_price ?? price`, centralizada em
`features/cart/pricing.ts` e reaproveitada pelo carrinho (evita cálculo
duplicado). Subtotal = soma de `effectivePrice × quantity` só sobre
itens cujo produto continua `active` — um item cujo produto foi
desativado depois de adicionado continua visível (para o visitante
remover), mas sai do subtotal monetário, com aviso "produto não está
mais disponível".

## Regras de tenant

Toda action recebe o `slug` da loja (nunca um `tenant_id`), resolve o
tenant do mesmo jeito que toda página do storefront
(`resolveStorefrontTenant`), e revalida o `productId` recebido contra
ESSE tenant (`select ... where id = $1 and tenant_id = $2`, que já usa a
mesma projeção pública com RLS filtrando `status = 'active'`) antes de
aceitar qualquer coisa no carrinho — nunca confia num `product_id`
isolado. Um trigger no banco (`prevent_cross_tenant_cart_item`, mesmo
padrão de `prevent_cross_tenant_category` da Etapa 7) é a segunda
camada: rejeita fisicamente um `cart_items` cujo produto não pertença ao
mesmo tenant do carrinho, ou cujo `tenant_id` não bata com o do carrinho
pai — testado explicitamente (produto de outro tenant, produto
inexistente, produto inativo, `tenant_id` inconsistente).

## Migrations e rollout

As migrations históricas criam `carts`/`cart_items`, invariantes de
tenant e `public.add_to_cart()`. O hardening é aditivo e usa
expand/deploy/contract:

1. `20261026210715_20260817220122_cart_ownership_expand.sql` adiciona
   `owner_token_hash`, `checkout_order_id` e a RPC privilegiada de
   checkout, sem quebrar a aplicação anterior.
2. A aplicação passa a resolver posse no BFF com `service_role` e o
   segredo do cookie.
3. `20261026210716_20260817220123_cart_checkout_lockdown.sql` remove policies, grants
   e `EXECUTE` de `PUBLIC`, `anon` e `authenticated` sobre carrinhos e
   RPCs privilegiadas.

O procedimento operacional e a recuperação estão em
`docs/runbooks/cart-security-rollout.md`.

## Segurança — autorização de carrinho anônimo

`carts` e `cart_items` não são expostos diretamente no Data API. Os
papéis `PUBLIC`, `anon` e `authenticated` não têm privilégio de tabela
nem `EXECUTE` em `add_to_cart` ou nas RPCs de checkout. Toda operação
passa por uma Server Action tratada como entrada não confiável.

O BFF resolve o tenant pelo slug, lê `cart_id` e segredo apenas do
cookie HttpOnly, calcula o hash no servidor e exige a combinação
`tenant_id + cart_id + owner_token_hash`. Só então usa `service_role`,
sempre com filtros explícitos. O PostgreSQL repete a verificação dentro
de `checkout_cart_secure`; conhecer ou enumerar um UUID não autoriza
leitura, alteração, remoção nem criação de pedido.

Testes negativos cobrem listagem/CRUD/RPC com anon e authenticated,
token ausente, token errado, carrinho de outro tenant e tentativa de
checkout direto. Testes positivos preservam o checkout convidado sem
conta.

## Concorrência

`public.add_to_cart()` continua fazendo
`insert ... on conflict (cart_id, product_id) do update set quantity =
least(quantity + excluded.quantity, 99)` numa única instrução atômica —
duas chamadas quase simultâneas para o mesmo produto nunca criam duas
linhas nem perdem um incremento. A diferença é a fronteira: a função só
pode ser chamada por `service_role`, depois da autorização de posse no
BFF. Botão e controles continuam desabilitados durante a operação, mas
isso é UX, não controle de segurança.

**Limitação aceita, documentada**: criar um carrinho novo (quando ainda
não há cookie) não é atômico — duas requisições quase simultâneas sem
cookie prévio podem, em teoria, criar duas linhas `carts` para o mesmo
tenant/visitante (o cookie da última resposta é o que prevalece). O pior
caso é um carrinho vazio órfão no banco, nunca um item duplicado visível
nem uma inconsistência de dado — aceito por ora, não implementado um
lock/`upsert` para esse caso específico nesta etapa.

## Auditoria

Não criado nenhum evento de `audit_logs` para ações de carrinho — o
prompt (§15) é explícito que operação de visitante não precisa gerar
log administrativo, e nenhuma ação estrutural/administrativa foi tocada
nesta etapa.

## Componentes

`AddToCartButton` (seletor de quantidade + submit real, confirmação/erro
inline), `CartItemRow` (stepper +/-, remover, mesma estrutura em
desktop/mobile), `CartSummary` (subtotal, qtde, "Limpar carrinho" via
`ConfirmDialog` reaproveitado, botão de checkout desabilitado com legenda
"em breve"). `StorefrontHeader`/`StorefrontShell` ganharam `storeSlug`/
`cartCount` (contador real, nunca fixo). `StorefrontEmptyState` ganhou um
slot `action` opcional (reaproveitado para "Continuar comprando" no
carrinho vazio, em vez de criar um componente de estado vazio novo).

## Nuance de cache — ISR perdida no storefront a partir desta etapa

O contador do carrinho no header depende de `cookies()` (via `getCart`),
que o Next trata como API dinâmica sempre — diferente da nuance da
Etapa 7 (só `searchParams` filtrado perdia o cache de 60s, a home sem
filtro continuava elegível). A partir de agora, `/loja/[slug]`,
`/loja/[slug]/produto/[slug]` e a nova `/loja/[slug]/carrinho` são
`force-dynamic` — nenhuma delas se beneficia mais do `revalidate = 60`
(explicitado no código, não deixado implícito). Aceito: mostrar o
contador do carrinho corretamente em toda página é mais importante que
60s de cache nesta etapa; uma estratégia de invalidação seletiva (ex.:
cache do catálogo + fetch client-side só do contador) fica como decisão
pendente para quando performance justificar o esforço.

## Testes

`tests/unit/cart-pricing.test.ts` (7 testes — `effectivePrice`,
`lineSubtotal`, `cartSubtotal` incluindo exclusão de item indisponível,
e o nome do cookie por loja). `tests/integration/cart.test.ts` (18
cenários cobrindo os 20 itens pedidos no prompt) — RLS/trigger/RPC reais
contra Postgres: produto válido aceito; produto inexistente/de outro
tenant/inativo rejeitados pelo trigger; `add_to_cart` soma quantidade em
vez de duplicar linha e respeita o teto de 99; concorrência real via
`Promise.allSettled`; quantidade inválida rejeitada pelo `check`; remover/
limpar carrinho; múltiplos produtos; carrinho vazio; ausência estrutural
de coluna de preço; persistência entre leituras separadas (equivalente a
"sobrevive a refresh" na camada de banco); `add_to_cart` é `anon`-only;
carrinhos de tenants diferentes operam sem interferência.

**Total da suíte: 165/165 testes passando** (142 da Etapa 8 + 7 unitários
+ 18 de integração, novos).

## Limitações

- Postgres real + stub, não Supabase real — mesma ressalva de sempre.
- "Sobrevive a refresh"/"experiência mobile" verificados por build +
  revisão de código + o teste de persistência entre conexões separadas
  descrito acima — não por um teste E2E de navegador real.
- Criação de carrinho não é atômica sob concorrência (ver "Concorrência"
  acima) — pior caso é um carrinho vazio órfão, não um dado incorreto.

## Decisões pendentes

- Estratégia de invalidação seletiva de cache para recuperar ISR no
  storefront sem perder a precisão do contador do carrinho.
- `customer_id`/associação de carrinho a cliente identificado — quando
  a etapa de clientes/checkout existir.
- Job de expiração/limpeza de carrinhos abandonados — a coluna
  `updated_at` já existe para isso, mas nenhum job foi criado agora.

## Comparação com o CHECKLIST MASTER

Nenhum arquivo "CHECKLIST MASTER" existe neste repositório para
comparar linha a linha (mesma ausência já registrada para `DESIGN.md`
em etapas anteriores). Usado como referência o roadmap da arquitetura
técnica (§24) e o próprio checklist de aceite do prompt desta etapa
(§22) — todos os 24 itens desse checklist foram implementados e
verificados; nenhuma funcionalidade de etapa futura foi antecipada.

## Funcionalidades deliberadamente deixadas para etapas posteriores

Checkout completo, pagamento (Mercado Pago/PagBank/Asaas/Stripe), pedido
definitivo, cálculo de frete/Correios, cupom/desconto, cliente
cadastrado/login, estoque/variantes, assinatura/cobrança da VEXO,
domínio próprio, painel MASTER, relatórios, IA, API pública — todas fora
do escopo por instrução explícita do prompt desta etapa.
