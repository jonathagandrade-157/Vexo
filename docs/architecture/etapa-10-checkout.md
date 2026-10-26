# Etapa 10 — Checkout e Finalização do Pedido

> Documentação curta desta etapa. Para o desenho completo ver
> `docs/architecture/vexo-arquitetura-tecnica.md` §5.3 (`orders`/
> `order_items`/`create_order_from_cart` já estavam desenhados ali,
> adaptados aqui para cliente convidado — ver "Modelo de dados" abaixo)
> e `docs/architecture/etapa-9-carrinho.md` (base sobre a qual esta
> etapa é construída). Sem `DESIGN.md`/"CHECKLIST MASTER" no
> repositório — mesma situação já registrada em etapas anteriores.

## Fluxo implementado

```
/loja/[slug]/carrinho → "Finalizar compra" (agora real, era "em breve"
  na Etapa 9) → /loja/[slug]/checkout (identificação + endereço +
  resumo, formulário único com seções) → createOrderAction →
  create_order_from_cart() (RPC transacional) →
  /loja/[slug]/pedido/[orderId] (confirmação)
```

## Achado que mudou o desenho: `private.log_audit()` não aceitava ator anônimo

`log_audit` (Etapa 2) rejeita logar um evento de tenant quando o ator
não é membro/platform admin/`service_role` — correto para todo evento
até agora (sempre staff autenticado). O checkout é 100% anônimo (mesmo
modelo do carrinho), então `ORDER_CREATED` derrubaria a transação
inteira sem uma exceção. Resolvido com **uma exceção estreita**, no
mesmo padrão já usado para `TENANT_CREATED` ("quem acabou de criar o
tenant ainda não é membro dele") — escopada só à action `ORDER_CREATED`
e só quando o tenant é publicado de verdade, nunca um acesso genérico.
Não enfraquece a guarda para nenhum outro evento existente (migration
`20260817220035_audit_orders.sql`, com o comentário completo do
raciocínio).

## Modelo de dados

Nenhuma estrutura reaproveitável existia (confirmado por busca antes de
criar). `orders`/`order_items` já estavam na arquitetura (§5.3), mas
`orders.customer_id` apontava para uma tabela `customers` que não existe
ainda (fora do escopo — "não criar conta de cliente"). Adaptado: `orders`
guarda `customer_name`/`customer_email`/`customer_phone` diretamente
(cliente convidado). `shipping_address` é `jsonb` (snapshot, nunca
recalculado a partir de um cadastro que pode mudar depois) com checagem
estrutural das chaves mínimas no próprio banco, além da validação Zod.
`order_items.product_id` é `on delete set null` (não cascade) —
diferente de `cart_items` — porque o snapshot (`product_name`,
`product_slug`, `unit_price`, `subtotal`) precisa sobreviver mesmo que o
lojista exclua o produto depois; só o carrinho (não histórico) pode
perder a linha quando o produto some.

`discount_total`/`shipping_total` são forçados a `0` por `check`
constraint no próprio banco (não só convenção de aplicação — cupom e
frete não existem ainda). `total = subtotal + shipping_total -
discount_total` também é um `check`, não um valor confiado a nenhuma
camada. `status` usa `check (status in ('PENDING'))` — cresce por
migration quando os próximos estados forem aprovados (mesmo padrão de
`products.status`), de propósito só `PENDING` nesta etapa.

## Regras de preço e criação do pedido

`public.checkout_cart_secure()` é o único caminho da aplicação para criar
um pedido. A função é `SECURITY DEFINER`, mas só `service_role` tem
`EXECUTE`; `PUBLIC`, `anon` e `authenticated` são revogados
explicitamente. Antes de qualquer escrita, ela revalida no PostgreSQL
`tenant_id + cart_id + owner_token_hash`. A função histórica
`create_order_from_cart()` permanece como detalhe interno também
restrito a `service_role`.

Sequência, dentro de uma única transação (tudo ou nada):

1. trava o carrinho (`for update` — ver "Anti-duplicidade" abaixo);
2. confirma que o carrinho pertence ao tenant informado e que o tenant
   está publicado;
3. gera o `order_number` (sequence dedicada, só para referência humana);
4. cria a linha do pedido (valores zerados);
5. para cada item do carrinho, lê o produto **ao vivo** (nunca o preço
   de quando foi adicionado ao carrinho — testado explicitamente:
   mudar o preço entre adicionar e finalizar usa o preço novo) —
   qualquer produto que não pertença mais ao tenant ou não esteja
   `active` aborta a função inteira;
6. cria os `order_items` com o snapshot (nome/slug/preço no momento);
7. recalcula `subtotal`/`total` no servidor e atualiza o pedido;
8. só então limpa `cart_items` do carrinho usado.

O frontend nunca é autoridade sobre preço/subtotal/total — a assinatura
da função nem sequer aceita esses valores como parâmetro (mass
assignment estruturalmente impossível, mesmo padrão do `add_to_cart` da
Etapa 9).

## Anti-duplicidade / concorrência

`checkout_cart_secure` trava a linha do carrinho com `for update`. Ao
final, grava o pedido em `carts.checkout_order_id`; retries sequenciais
ou concorrentes devolvem o mesmo `orderId` com `created=false`. A chave
estável do gateway também impede criar outra preferência/cobrança para
o mesmo pedido. Se preço, estoque ou frete falhar, a transação inteira é
revertida, inclusive reserva e limpeza do carrinho.

## Segurança

Revisão explícita contra os 18 itens do checklist do prompt (§24):

- **Tenant hopping / manipulação de `cart_id`**: o navegador não envia
  `cart_id` para o checkout. O BFF deriva as credenciais do cookie e a
  RPC exige tenant, UUID e hash do segredo. Carrinho de outro tenant ou
  token incorreto recebe a mesma falha de autorização.
- **IDOR / manipulação de `order_id`**: `get_order_confirmation` só
  retorna dados quando `(tenant_id, order_id)` combinam de verdade —
  testado que um `order_id` real de outro tenant, ou um `order_id`
  aleatório, sempre retornam `null` (nunca um erro que confirme
  existência, nem um vazamento parcial).
- **URL de confirmação não usa o `order_number`**: o prompt sugere
  `[orderNumber]` como exemplo, mas `order_number` é sequencial e
  adivinhável — usá-lo como chave de busca seria um IDOR real (enumerar
  pedidos, expondo nome/endereço de outros clientes). A rota usa o `id`
  do pedido (uuid, 122 bits, não adivinhável) — mesmo modelo de "token
  de posse" já usado para `cart_id`. Deliberadamente diferente do
  exemplo do prompt, documentado aqui o porquê.
- **Produto de outro tenant / produto inativo / produto inexistente**:
  herdado do trigger `prevent_cross_tenant_cart_item` (Etapa 9) — um
  carrinho nunca consegue conter um produto de outro tenant em primeiro
  lugar; `create_order_from_cart` ainda revalida `status = 'active'` no
  momento do checkout (o produto pode ter sido desativado DEPOIS de
  adicionado ao carrinho).
- **Preço/quantidade/total manipulados, mass assignment**: nenhum desses
  valores é um parâmetro aceito pela função — estruturalmente
  impossível, não só validado.
- **Replay attack / double submit / race condition / pedido duplicado**:
  lock de linha + `checkout_order_id` idempotente; ver acima.
- **XSS/SQL injection**: toda escrita via parâmetro de função (nunca
  concatenação); renderização sempre via JSX (React escapa por padrão);
  `grep` dedicado confirmou zero `dangerouslySetInnerHTML`/`service_role`
  em todo o código novo desta etapa.
- **Exposição de dados pessoais**: `get_order_confirmation` retorna uma
  projeção mínima (sem `tenant_id`, sem id interno de `order_items`,
  sem `product_id`, sem e-mail/telefone do cliente); o log de auditoria
  também guarda só `order_number`/`total`/`status`, nunca nome/e-mail/
  endereço (testado explicitamente).
- **RLS e grants**: `orders`/`order_items` continuam sem policy de escrita
  para visitante. Além disso, tabelas de carrinho e RPCs privilegiadas
  não são alcançáveis pelos papéis públicos. Staff só lê via
  `orders.view`, preservando isolamento entre tenants.

Nenhuma vulnerabilidade exigiu correção depois de escrita — a exceção em
`log_audit` (ver acima) foi um ajuste necessário identificado e resolvido
durante o próprio desenho, antes de qualquer código de checkout ser
escrito, não uma correção posterior a uma falha encontrada em teste.

## UI

Formulário único com seções (identificação, entrega, resumo) — mesmo
padrão dos formulários do painel (Etapa 7/8), não um wizard, não um
design novo. `OrderSummary` reaproveitado pelo checkout (a partir do
carrinho ao vivo) e pela confirmação (a partir do snapshot salvo) —
evita duplicar o cálculo/markup em dois lugares. `CartSummary` (Etapa 9)
teve o botão "Finalizar compra" ativado — era desabilitado "em breve".

## Testes

`tests/unit/checkout-schema.test.ts` (8 testes — validação Zod:
e-mail/telefone/CEP/nome/estado inválidos, complemento opcional).
`tests/integration/checkout.test.ts` (16 cenários cobrindo os 32 itens
pedidos no prompt) — RLS/trigger/RPC reais contra Postgres: checkout
vazio bloqueado (nenhum pedido criado); produto inativo rejeitado E
carrinho preservado; produto de outro tenant estruturalmente impossível
(herdado da Etapa 9); preço sempre ao vivo, nunca o do momento de
adicionar ao carrinho; criação completa com snapshot correto; carrinho
limpo só após sucesso; double-submit sequencial e concorrência real
(`Promise.allSettled`) nunca duplicam pedido; auditoria mínima sem PII;
`get_order_confirmation` nunca vaza pedido de outro tenant nem por
`order_id` aleatório; RLS de staff correta; tenant hopping via `cart_id`
bloqueado; funções `anon`-only.

**Total da suíte: 187/187 testes passando** (165 da Etapa 9 + 8
unitários + 16 de integração, novos).

## Limitações

- Postgres real + stub, não Supabase real — mesma ressalva de sempre.
- UI responsiva/mobile verificada por build + revisão de código, não
  E2E de navegador (mesma limitação de toda etapa anterior do
  storefront).
- `order_number` (sequence do Postgres) não é transacional — uma
  tentativa de checkout que falha (produto inativo, etc.) "queima" um
  número sem gerar pedido, deixando lacunas na sequência. Comportamento
  padrão/esperado de qualquer numeração sequencial com falhas
  possíveis, não um bug.

## Decisões pendentes

- `/painel/pedidos` (gestão de pedidos pelo lojista) continua "coming
  soon" — fora do escopo desta etapa, que foi só a criação via
  storefront. RLS de leitura (`orders.view`) já está pronta para quando
  essa tela existir.
- `customer_id`/associação a cliente identificado — quando a etapa de
  contas de cliente existir, `orders` ganha a coluna via migration
  incremental (não bloqueado pelo desenho atual).
- Máquina de estados completa do pedido (Pago/Preparando/Enviado/
  Entregue/Cancelado) — etapa futura de pagamento/operação.

## Funcionalidades deliberadamente NÃO implementadas

Mercado Pago, PagBank, Asaas, Stripe, PIX real, cartão, boleto, gateway,
webhook de pagamento, frete/Correios, cupom/desconto, estoque/variantes,
conta/login de cliente, assinatura/cobrança da VEXO, painel MASTER,
relatórios, IA, API pública, domínio personalizado, marketplace — todas
fora do escopo por instrução explícita do prompt desta etapa.
