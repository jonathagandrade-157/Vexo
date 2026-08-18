# Etapa 12 — Frete, Entrega e Cálculo de Frete no Checkout

## Duas ressalvas antes de qualquer coisa

1. Não há credenciais reais de Correios/Melhor Envio disponíveis nesta etapa — nenhuma integração real de transportadora foi inventada. Só existe `flat_rate`: preço fixo, configurado pelo próprio lojista, sem variar por CEP/peso.
2. `create_order_from_cart` (Etapa 10) e o fluxo de pagamento (`initiatePaymentForOrder`, Etapa 11) continuam **inalterados**. O frete é aplicado como um passo adicional entre os dois — mesmo padrão que a Etapa 11 já usou para inserir o pagamento depois da criação do pedido, sem tocar em `create_order_from_cart`.

## Arquitetura de provedores de frete

```
Checkout / Route Handler de cotação
        │
        ▼
 features/shipping/quote.ts, checkout.ts   (nunca fala com uma implementação concreta)
        │
        ▼
 lib/shipping/registry.ts :: getShippingProvider(type)
        │
        ▼
 lib/shipping/provider.ts :: ShippingProvider (interface)
        │
        ▼
 lib/shipping/flat-rate.ts   (única implementação real desta etapa)
```

Mesmo desenho de `lib/payments/gateway.ts`/`registry.ts` (Etapa 11): um provedor real de transportadora (Correios/Melhor Envio) entra depois só como um novo arquivo + um `case` em `registry.ts`, sem tocar checkout, cotação ou UI do painel.

## Modelo de dados

Duas tabelas novas, ambas com `tenant_id`, RLS habilitada **e forçada** (`force row level security`):

- **`shipping_settings`** — uma linha por tenant (`tenant_id` é a própria PK): `enabled` (liga/desliga a entrega da loja) e `origin_zip` (CEP de origem, opcional, guardado para uma futura integração real de transportadora — não é usado em nenhum cálculo nesta etapa).
- **`shipping_methods`** — 1:N por tenant: `type` (só `'flat_rate'` por enquanto — cresce por migration quando um provedor real existir, mesmo padrão de `products.status`/`orders.status`), `name`, `price`, `estimated_days` (opcional), `status` (`active`/`inactive`), `sort_order`. `unique (tenant_id, name)`.

`orders` (Etapa 10) ganhou 4 colunas de **snapshot** — `shipping_method`, `shipping_provider`, `shipping_estimated_days`, `shipping_reference` — sem FK para `shipping_methods` (a modalidade pode ser excluída/alterada depois; o pedido preserva seu próprio retrato, mesmo princípio de `order_items` desde a Etapa 10). O check `orders_shipping_total_check`, que a Etapa 10/11 documentaram como `= 0` "até o frete ser aprovado", foi solto para `>= 0` nesta etapa — exatamente a migration futura que já estava prevista.

## Fluxo de checkout

1. Cliente preenche o CEP (mesmo campo já usado para o endereço, Etapa 10 — não duplicado).
2. O formulário (client-side) chama `GET /api/shipping/quote?slug=...&zip=...`, que resolve o tenant pelo slug (`resolveStorefrontTenant`, Etapa 6 — nunca um `tenant_id` solto do cliente) e devolve as modalidades ativas via `ShippingProvider.getQuote`.
3. Cliente escolhe uma modalidade — o preço exibido nunca é calculado no navegador, só o que o servidor devolveu.
4. Ao enviar o formulário, `createOrderAction` (`features/checkout/actions.ts`):
   a. **Revalida o preço ANTES de criar o pedido** (`verifyShippingPriceFresh`) — se o preço mudou desde a cotação, o pedido nem chega a ser criado; o cliente recebe um erro amigável pedindo para selecionar de novo.
   b. Chama `create_order_from_cart` (Etapa 10, inalterada) — o pedido nasce com `shipping_total = 0`, como sempre.
   c. Chama `apply_shipping_to_order` (RPC nova, `anon`-only, `security definer`) — relê `shipping_methods.price` **de novo, atomicamente**, e só então grava `shipping_total`/`shipping_method`/`shipping_provider`/`shipping_estimated_days`/`shipping_reference` e recalcula `total = subtotal + shipping_total - discount_total`.
   d. Chama `initiatePaymentForOrder` (Etapa 11, inalterada) — que já lê `orders.total` fresco, então automaticamente inclui o frete recém-aplicado no valor cobrado.

Se a loja não tem entrega habilitada (ou não tem modalidade ativa), os passos (a)/(c) são pulados — o pedido segue com `shipping_total = 0`, mesmo comportamento da Etapa 10.

## Tabelas/funções criadas

| Objeto | Tipo | Descrição |
|---|---|---|
| `shipping_settings` | tabela | 1 linha por tenant — liga/desliga entrega, CEP de origem |
| `shipping_methods` | tabela | 1:N por tenant — modalidades de entrega (flat_rate) |
| `apply_shipping_to_order` | função (`anon`-only) | Aplica/revalida o frete a um pedido `PENDING` |

## Migrations (4, incrementais)

1. `20260817220046_shipping_tables.sql` — tabelas, RLS, triggers (`set_updated_at`, `prevent_tenant_id_change`).
2. `20260817220047_orders_shipping_fields.sql` — solta `orders_shipping_total_check` para `>= 0`, adiciona as 4 colunas de snapshot.
3. `20260817220048_apply_shipping_to_order_function.sql` — a função de aplicação/revalidação.
4. `20260817220049_audit_shipping_events.sql` — triggers de auditoria.

## Permissões

Nenhuma permissão nova. `settings.update` (Etapa 2) já cobre toda a escrita de `shipping_settings`/`shipping_methods` no painel — mesma permissão que já governa `/painel/configuracoes` (perfil da loja). Leitura no painel é liberada a qualquer membro do tenant (`is_tenant_member`), igual ao padrão de `shipping_settings`/categorias.

## Segurança

- **Anti-manipulação de preço**: o preço final nunca vem do cliente. `apply_shipping_to_order` sempre relê `shipping_methods.price`; o parâmetro `p_expected_price` só serve para **detectar divergência e recusar** — nunca para gravar.
- **Anti-pedido-órfão**: `verifyShippingPriceFresh` roda ANTES de `create_order_from_cart`, evitando criar um pedido cujo frete não pode mais ser aplicado pelo preço que o cliente viu.
- **Isolamento multi-tenant**: toda leitura/escrita de `shipping_settings`/`shipping_methods` é escopada por `tenant_id` — RLS (`force row level security`) para o painel, e checagem explícita `tenant_id = p_tenant_id` dentro de `apply_shipping_to_order` para o RPC `anon`. Testado (tenant hopping em pedido e em modalidade — `tests/integration/shipping.test.ts`).
- **RLS de leitura pública**: `anon` só vê `shipping_settings` com `enabled = true` e `shipping_methods` ativas de lojas com entrega habilitada e não suspensas/excluídas — mesmo padrão de menor privilégio de `products`/`categories` (Etapa 7), nunca alargado para `authenticated` (lição da Etapa 6).
- **Mass assignment**: allowlist Zod em `features/shipping/schema.ts` — `type` é sempre `'flat_rate'` fixo no servidor (nunca aceito do formulário), `status` só muda por uma ação dedicada (`toggleShippingMethodStatusAction`), nunca um campo livre do form de criar/editar.
- **`search_path = ''`**: todas as funções/triggers novas fixam `search_path` vazio (mesma disciplina de todo o projeto desde a Etapa 2).
- **Auditoria sem dado sensível**: `SHIPPING_SETTINGS_UPDATED`/`SHIPPING_METHOD_CREATED`/`UPDATED`/`DELETED` — nunca há segredo envolvido (frete não usa credencial nenhuma nesta etapa), mas o payload mesmo assim é uma projeção mínima (nome/preço/prazo/status), nunca a linha inteira.
- **`apply_shipping_to_order` é `anon`-only**: `authenticated`/`service_role` não têm `EXECUTE` — testado explicitamente.
- **Achado e corrigido durante a revisão de segurança (não só documentado)**: a primeira versão de `createOrderAction` tratava `shippingMethodId`/`shippingPrice` como totalmente opcionais — se o cliente (ou uma chamada direta ao Server Action, fora do formulário/JS do navegador) simplesmente omitisse os dois campos, o pedido era criado e pago com `shipping_total = 0`, mesmo numa loja com entrega paga habilitada e configurada como obrigatória. Corrigido com `isShippingRequired()` (`features/shipping/checkout.ts`): antes de criar o pedido, o servidor verifica `shipping_settings.enabled` do próprio tenant — se `true`, a seleção de modalidade passa a ser exigida no servidor (não só desabilitando o botão no cliente), e a ausência dela é um erro de checkout, não um pedido "silenciosamente sem frete".

## Testes

`tests/integration/shipping.test.ts` (13 cenários) cobre: RLS de escrita (só `settings.update`)/leitura (qualquer membro) de `shipping_settings`/`shipping_methods`; leitura pública `anon` escopada por `enabled`/`status`/tenant; unicidade de nome por tenant; `apply_shipping_to_order` — caminho feliz (preço/total/snapshot corretos), preço divergente rejeitado, modalidade inativa rejeitada, modalidade de outro tenant rejeitada, pedido de outro tenant rejeitado, pedido fora de `PENDING` rejeitado, grant `anon`-only; `orders_shipping_total_check` agora aceita `> 0` mantendo `discount_total` forçado a `0`; auditoria dos 4 eventos. Suíte completa (`npm test`): 243/243, incluindo os 230 testes das Etapas 1–11 intactos.

## Limitações

- Só `flat_rate` (preço fixo por modalidade) — nenhuma integração real de transportadora, nenhum cálculo por peso/dimensão/CEP.
- Sem regras por região/faixa de CEP — decisão deliberada: o escopo original desta etapa excluiu explicitamente "tabelas de região"; `origin_zip` é coletado apenas como base para uma integração futura.
- Corrida residual muito estreita entre `verifyShippingPriceFresh` (pré-checagem) e `apply_shipping_to_order` (aplicação): se o lojista alterar o preço da modalidade nos milissegundos entre as duas chamadas, o pedido já criado segue para o pagamento com `shipping_total = 0` em vez de falhar — fica visível em `/painel/pedidos` para o lojista tratar manualmente. Mesmo nível de tolerância a corrida que a Etapa 11 já aceitou para a falha de `initiatePaymentForOrder`.
- Endpoint `/api/shipping/quote` não tem rate limiting dedicado (leitura pública, sem segredo nem escrita — mesmo perfil de risco do restante do storefront, que também não tem).

## Decisões pendentes

- Se/quando uma transportadora real (Correios/Melhor Envio) for integrada, definir se o cálculo por peso/dimensão exige novos campos em `products` (peso, dimensões) — não existem hoje.
- Se regras por região/CEP entrarem em uma etapa futura, decidir o modelo (faixa de CEP por modalidade vs. tabela de regiões) apenas quando o requisito for aprovado.

## Funcionalidades deliberadamente NÃO implementadas

- Motoboy próprio / entrega local por raio de distância.
- Cálculo por peso/dimensão do produto.
- Regras por região/CEP (tabelas de região).
- Integração real com Correios, Melhor Envio ou qualquer transportadora.
- Rastreamento de entrega, múltiplos endereços de origem/CD.
- Cupom de frete grátis condicional (frete grátis é obtido hoje só configurando uma modalidade com preço 0,00).
