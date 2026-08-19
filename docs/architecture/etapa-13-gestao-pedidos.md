# Etapa 13 — Gestão de Pedidos (Fulfillment)

## Objetivo

Dar ao lojista visibilidade e controle operacional sobre os pedidos recebidos — listar, ver detalhe completo e avançar o status ao longo do ciclo de vida pós-pagamento. `/painel/pedidos` deixa de ser `ComingSoon` e passa a usar dados reais.

## Arquitetura

```
/painel/pedidos (lista)              /painel/pedidos/[id] (detalhe)
        │                                     │
        ▼                                     ▼
 features/orders/data.ts :: listOrders   getOrderDetail
        │ (RLS-bound, .eq(tenant_id) explícito)
        ▼
 orders / order_items (Etapa 10) — leitura via `orders.view`

 features/orders/actions.ts :: updateOrderStatusAction
        │ (Server Action — resolve tenant da sessão, pré-checa orders.update)
        ▼
 public.update_order_status(tenant_id, order_id, new_status, note)   ← única escrita de orders.status
        │ (SECURITY DEFINER, authenticated-only, valida a transição internamente)
        ▼
 trigger audit_order_status_changed → private.log_audit() → audit_logs
```

Nenhuma tabela nova. `orders.view`/`orders.update` (permissões já existentes desde a Etapa 2) são reaproveitadas — nenhuma permissão nova foi criada.

## Máquina de estados

```
PENDING ──────────────────────────────► CANCELLED
PAID ─────► PREPARING ─────► SHIPPED ─────► DELIVERED
  │             │
  └──► CANCELLED └──► CANCELLED
```

### Transições permitidas
- `PENDING → CANCELLED`
- `PAID → PREPARING`
- `PAID → CANCELLED`
- `PREPARING → SHIPPED`
- `PREPARING → CANCELLED`
- `SHIPPED → DELIVERED`

### Transições proibidas (todas testadas explicitamente)
`PENDING→PAID`, `PENDING→PREPARING`, `PAID→SHIPPED`, `PAID→DELIVERED`, `PREPARING→DELIVERED`, `SHIPPED→CANCELLED`, `DELIVERED→*` (qualquer), `CANCELLED→*` (qualquer).

A tabela está hard-coded dentro de `update_order_status` (migration `20260817220051`) — exaustiva, sem `else` permissivo. `features/orders/schema.ts::ALLOWED_TRANSITIONS` espelha exatamente a mesma tabela, mas só para a UI esconder opções que não fariam sentido — **a segurança nunca depende dela**: mesmo que o `<select>` do formulário fosse manipulado no navegador para enviar uma transição não listada, a função no banco rejeita.

## RPC `update_order_status`

`security definer`, `set search_path = ''`, `authenticated`-only (revogado de `public`/`anon`/`service_role`). Passos internos, nesta ordem:
1. `private.has_permission(p_tenant_id, 'orders.update')` (ou `is_platform_admin()`) — sem isso, exceção `42501` antes de tocar em qualquer linha.
2. Busca o pedido por `(id, tenant_id)` — se não encontrado (pedido não existe ou pertence a outro tenant), exceção `P0002` "order not found for this store".
3. Valida a transição contra a tabela acima — fora dela, exceção `P0001` "invalid order status transition from % to %".
4. `UPDATE` de `status` e `internal_note` juntos, na mesma instrução, sempre escopado por `(id, tenant_id)`.

`payment_status` (Etapa 11) nunca é tocado por esta função — nem lido, nem escrito. Cancelar um pedido é só uma mudança de `status`.

## Permissões e RLS

- Reaproveita `orders.view`/`orders.update` (Etapa 2) — nenhuma permissão nova.
- `orders`/`order_items` continuam **sem nenhuma policy de `UPDATE`** para `authenticated` (a única policy é a `SELECT` de `orders.view`, Etapa 10) — a escrita de status só é possível através da função `SECURITY DEFINER`, nunca por um `UPDATE` direto liberado por RLS. Isto é deliberado: uma regra de negócio (a máquina de estados) não é algo que uma policy de RLS consiga expressar bem, então a autorização + a regra vivem juntas, dentro da função.
- `anon` continua sem nenhuma policy em `orders`/`order_items` (igual a todas as etapas anteriores).
- `getOrderDetail`/`listOrders` usam o cliente de sessão (RLS-bound, nunca `service_role`) e ainda assim escopam explicitamente por `tenant_id` — defesa em profundidade, mesmo padrão de todas as etapas anteriores.
- Testado: tenant hopping via `update_order_status` (pedido de outro tenant não é encontrado), via `listOrders`/`getOrderDetail` (RLS já barra a leitura), acesso sem `orders.view`, alteração sem `orders.update`, `anon`/`service_role` sem `EXECUTE` na função.

## Auditoria

Reaproveita `audit_logs` (Etapa 2) — **nenhuma tabela `order_status_history` foi criada**. Um trigger `AFTER UPDATE` (`audit_order_status_changed`, mesmo princípio "estruturalmente acoplado à mutação" de `audit_order_created`, Etapa 10) dispara só quando `old.status is distinct from new.status`, registrando `ORDER_STATUS_CHANGED` com:
- `before`: `{ status: <status anterior> }`
- `after`: `{ status: <novo status>, note: <nota, se houver> }` — nota omitida do JSON quando `null`, nunca gravada como string vazia.
- `actor`/`tenant`/`timestamp`: os mesmos campos padrão de `audit_logs`, derivados internamente por `private.log_audit()` (nunca aceitos como parâmetro).

A página de detalhe do pedido lê esse histórico diretamente de `audit_logs` (`resource_type = 'order'`, `resource_id = order_id`, ações `ORDER_CREATED`/`ORDER_STATUS_CHANGED`) — qualquer membro do tenant já tem `SELECT` em `audit_logs` do próprio tenant (Etapa 2), sem checagem adicional.

## Nota interna

`orders.internal_note` (nova coluna, `text`, até 500 caracteres) — a nota mais recente anexada a uma transição de status. **Nunca exposta** ao cliente: `get_order_confirmation` (Etapa 10/11, inalterada nesta etapa) não seleciona essa coluna — confirmado por teste (`internal note is never exposed via get_order_confirmation`). No painel, a seção "Nota interna" da página de detalhe é visível a qualquer usuário com `orders.view` (a mesma permissão que já libera ver todo o resto do pedido) — não uma permissão separada, pela mesma razão de "nota interna" ser conceitualmente parte do próprio pedido, não um dado mais sensível que o pedido inteiro.

## Cancelamento — comportamento explícito

**Cancelar um pedido (`* → CANCELLED`) NUNCA dispara automaticamente:**
- reembolso ou estorno;
- qualquer chamada ao Mercado Pago;
- qualquer alteração em `orders.payment_status`.

`update_order_status` só escreve em `orders.status`/`orders.internal_note`. Se o pedido já foi pago, o estorno — se necessário — é uma decisão e uma ação manual do lojista fora desta função, em uma etapa futura. Testado explicitamente (`cancelling a PAID order never touches payment_status`).

## Segurança — pontos verificados

- Máquina de estados exaustiva, no servidor, sem `else` permissivo.
- Nenhuma policy de `UPDATE` em `orders` para `authenticated` — a única escrita é via a função.
- Tenant sempre resolvido da sessão (`resolveActiveTenantForUser`) na Server Action; a função ainda revalida `(id, tenant_id)` internamente, independente do que a Action já checou.
- Busca da listagem (`listOrders`) sanitiza o termo antes de interpolar em `.or()` (PostgREST) — remove `,()` e escapa `%`/`_`/`\` — evitando que a entrada do lojista seja interpretada como sintaxe de filtro adicional. O isolamento de tenant em si nunca dependeu disso: `.eq("tenant_id", tenantId)` é um parâmetro top-level, sempre combinado com `AND` pelo PostgREST, nunca afetado pelo conteúdo de `.or()`.
- `ALLOWED_TRANSITIONS` no cliente é só UX — a autoridade real é sempre a função no banco.

### Achado e corrigido durante a revisão de segurança (não só documentado)

A primeira versão de `update_order_status` lia o pedido com um `SELECT` simples (sem `FOR UPDATE`), validava a transição contra essa leitura em memória, e só então escrevia com um `UPDATE ... WHERE id = ... AND tenant_id = ...` — sem revalidar o status no momento da escrita. Sob concorrência real (duas chamadas simultâneas a partir do MESMO status de origem, cada uma individualmente válida — ex.: `PREPARING → SHIPPED` e `PREPARING → CANCELLED`), a segunda escrita, destravada depois que a primeira já tinha avançado a linha, podia aplicar seu `p_new_status` por cima de um status que não era mais o validado, produzindo uma transição **fora** da máquina de estados (`SHIPPED → CANCELLED` no exemplo) — exatamente o que a função existe para nunca permitir.

Corrigido tornando leitura-validação-escrita atômica: o `UPDATE` final ganhou `and status = v_order.status` na cláusula `WHERE` — a mesma instrução que grava também confirma que o status real da linha ainda é o que foi validado; se outra transação já mudou, nenhuma linha corresponde e a função levanta `'order status changed concurrently, please retry'` (`errcode 40001`) em vez de aplicar a escrita. Regressão coberta por teste dedicado (`tests/integration/order-management.test.ts`, "two concurrent update_order_status calls...") — duas chamadas concorrentes a partir do mesmo status, exatamente uma vence, a outra é rejeitada, a combinação inválida nunca é observada.

## Fora do escopo (explícito)

- Notificação por e-mail/SMS ao cliente quando o status muda.
- Reembolso/estorno automático (manual, fora desta etapa).
- Tabela `customers` / conta de cliente.
- Contador de pedidos no dashboard (Início) — decisão explícita de não implementar por não haver garantia de que ficaria sem dívida técnica.
- Rastreio real de transportadora, exportação/relatórios.

## Testes

`tests/integration/order-management.test.ts` (27 cenários): as 6 transições válidas, as 10 transições inválidas mais relevantes (incluindo `DELIVERED`/`CANCELLED` como estados terminais), a corrida de concorrência (achado da revisão de segurança, ver acima), RLS de leitura (`orders.view`, isolamento por tenant, `anon` sem acesso), `update_order_status` `authenticated`-only, rejeição sem `orders.update`, tenant hopping, auditoria (`before`/`after`/`actor`/`tenant`), nota interna salva corretamente e nunca exposta via `get_order_confirmation`, `payment_status` intocado ao cancelar. Suíte completa: **269/269** (243 das Etapas 1–12 intactos + 26 novos).
