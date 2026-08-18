# Etapa 11 — Pagamentos e Integração com Gateways (Mercado Pago)

> Documentação curta desta etapa. Para o desenho completo ver
> `docs/architecture/vexo-arquitetura-tecnica.md` §11 (OAuth + Credential
> Vault, já detalhado ali antes desta etapa existir), §12.1 (webhooks) e
> §15 (pagamento do lojista vs. assinatura da VEXO). Sem `DESIGN.md`/
> "telas Stitch de pagamento" no repositório — mesma situação já
> registrada em etapas anteriores.

## Duas ressalvas antes de qualquer coisa

1. **Sem Supabase real neste ambiente** — `vault`/`pgsodium` só existem
   num projeto Supabase real. Um schema `vault` simplificado foi
   recriado em `tests/integration/fixtures/supabase-stub.sql` (mesmo
   padrão de `auth`/`storage`, Etapas 2/8) só para validar a integração
   **estrutural** — nunca a criptografia real do pgsodium.
2. **Sem credenciais reais do Mercado Pago** — todo o código fala com os
   endpoints REAIS documentados publicamente pelo Mercado Pago (chamadas
   `fetch` de verdade, não simuladas), mas nada foi executado contra o
   sandbox/produção deles. O formato exato de cada endpoint/header (em
   especial a assinatura de webhook, `x-signature`) deve ser reconferido
   contra a documentação oficial atual antes de produção.

## Arquitetura de gateways

`lib/payments/gateway.ts` (interface `PaymentGateway`) → `lib/payments/mercadopago.ts`
(única implementação real desta etapa) → `lib/payments/registry.ts`
(`getGateway(provider)`, único ponto que sabe instanciar cada provedor).
Checkout, OAuth e webhook só importam a interface/registry — PagBank/
Asaas/Stripe entram depois só com um novo arquivo de implementação + um
`case` no registry, sem tocar checkout/webhook/painel.

## Fluxo OAuth

Painel (`payments.manage`) → `connectMercadoPagoAction` gera `state`
assinado (`lib/security/oauth-state.ts`: HMAC, `tenant_id` + nonce +
expiração de 10min, stateless — a proteção real contra replay do fluxo
inteiro é o `code` do Mercado Pago ser de uso único, garantido pelo
próprio provedor) → redireciona para a autorização do MP → MP redireciona
para `/api/oauth/mercadopago/callback` (Route Handler — único ponto que
PRECISA ser uma rota real, já que é o Mercado Pago quem redireciona o
navegador com `code`+`state` via GET) → valida assinatura+expiração do
`state` → **confere de novo** que a sessão atual (mesmo browser, ainda
logada) pertence ao mesmo tenant do `state` com `payments.manage`
(segunda camada — o state por si só já garante isso, isto é defesa em
profundidade extra) → troca `code` por tokens inteiramente no servidor →
grava no vault (`service_role`) → grava metadado em
`store_payment_providers` (client de sessão normal, RLS) → audita →
redireciona para `/painel/configuracoes/pagamentos`.

## Fluxo de checkout

`create_order_from_cart` (Etapa 10) **inalterada** — o pedido continua
sendo criado exatamente pelo mesmo mecanismo. Depois: se a loja não tem
gateway conectado, o checkout bloqueia ANTES do formulário (nunca cria
um "pagar" falso, nunca cria pedido nesse caso). Se conectado:
`create_payment_for_order` (RPC anon, valor sempre de `orders.total`) →
`private.get_payment_credentials` (`service_role`, decifra o token do
lojista) → `gateway.createPayment` (cria a *preference* real no Mercado
Pago, `external_reference = order_id`) → `attach_payment_preference`
(RPC anon, grava o `preference_id`) → redireciona o cliente para o
checkout hospedado do Mercado Pago (`init_point`).

## Fluxo de webhook

`/api/webhooks/mercadopago` (Route Handler, `service_role` — não há
sessão de usuário num webhook): valida assinatura HMAC (`x-signature`/
`x-request-id`) **antes** de qualquer parsing de negócio → insert-or-ignore
em `payment_webhook_events` por `(provider, event_id)` (idempotência
real — um evento já `processed_at` retorna 200 sem reaplicar efeito
colateral; um evento que existe mas não foi processado é reprocessado,
já que o passo final é ele mesmo um upsert seguro) → resolve o tenant
por `connected_account_id` do payload, cruzado contra
`store_payment_providers` (nunca um `tenant_id` solto do payload) →
decifra o token → consulta o pagamento real na API do MP → `apply_payment_update`
(RPC `service_role`-only) atualiza `payments`/`orders.payment_status` e
só então `orders.status` para `PAID`, atomicamente, ignorando
silenciosamente se o valor reportado divergir de `orders.total`.

## Tabelas criadas (5)

- `store_payment_providers` — metadado público da conexão (nunca um
  segredo), `unique(tenant_id, provider)`.
- `payment_credentials_vault` — guarda **referências** (`access_token_secret_id`/
  `refresh_token_secret_id`) para `vault.secrets`, não texto cifrado por
  conta própria — `vault.create_secret()`/`vault.decrypted_secrets` já
  implementam envelope encryption de verdade (o Supabase gerencia a
  chave mestra); reimplementar AES-GCM à mão seria duplicar o que a
  própria arquitetura (§11.1) recomenda usar. **Zero RLS policy** para
  `anon`/`authenticated` (nem OWNER lê isto diretamente) — só as funções
  `private.*_payment_credentials()` (`service_role`-only) tocam a
  tabela.
- `payments` — uma linha por pedido (`unique(order_id)`, não um
  histórico de tentativas nesta etapa — decisão documentada abaixo);
  `amount` sempre copiado de `orders.total` no momento da criação.
- `payment_webhook_events` — idempotência de infraestrutura,
  `unique(provider, event_id)`.
- `orders` ganhou `payment_status` (coluna nova) e `status` ampliado
  para incluir `'PAID'` — exatamente como a Etapa 10 já previa ("cresce
  por migration quando os próximos estados forem aprovados"); a máquina
  de estados completa (Preparando/Enviado/Entregue) continua fora do
  escopo.

## Migrations (9, incrementais)

Permissões → `store_payment_providers` (+RLS) → `payment_credentials_vault`
(sem RLS de propósito) → `payments`+`payment_webhook_events` (+RLS) →
extensão de `orders` (`payment_status`, `status` ampliado) → funções de
vault (`service_role`-only) → funções de checkout de pagamento
(`create_payment_for_order`/`attach_payment_preference` anon-only;
`apply_payment_update` `service_role`-only) → auditoria (+ exceção
estreita em `log_audit` para `PAYMENT_CREATED`, mesmo padrão já criado
na Etapa 10 para `ORDER_CREATED`) → extensão de `get_order_confirmation`
(Etapa 10) para incluir o status real do pagamento.

## Permissões

`payments.view` (OWNER/ADMIN/MANAGER) e `payments.manage` (OWNER/ADMIN
só — conectar uma conta financeira é mais sensível que a maioria das
ações `*.manage`/`*.update` deste projeto, por isso MANAGER fica de
fora, diferente do padrão usual).

## `service_role` — onde e por quê

Usado em exatamente três lugares, todos documentados no código:

1. `lib/payments/vault.ts` — decifrar/gravar/apagar credenciais
   (arquitetura §11.1: "a única leitora é uma função de biblioteca
   isolada"). Nunca chamado de um Client Component.
2. `/api/oauth/mercadopago/callback` (só a chamada de `storePaymentCredentials`)
   — mesma razão.
3. `/api/webhooks/mercadopago` — não há sessão de usuário num webhook; a
   legitimidade vem da assinatura verificada, não de RLS.

Em nenhum dos três casos `service_role` vira bypass de regra de
negócio: toda validação (tenant, produto, valor, permissão) já aconteceu
antes de chegar nesse ponto, e as funções que ele chama
(`private.get_payment_credentials`, `apply_payment_update`) continuam
escopando tudo por `tenant_id`/`order_id` explicitamente.

## Segurança

Revisão contra os 17 itens do checklist do prompt (§22):

- **OAuth CSRF/state fixation/replay**: `state` assinado (HMAC) com
  `tenant_id`+nonce+expiração; testado que assinatura errada, payload
  adulterado e state expirado são todos rejeitados.
- **Token leakage/secret exposure**: `grep` dedicado confirmou zero
  `console.log`/token em qualquer arquivo novo desta etapa; a página do
  painel só mostra o identificador MASCARADO da conta conectada
  (`maskAccountId`, mesmo critério em SQL e TS); o vault nunca tem
  policy de leitura para `anon`/`authenticated`, testado explicitamente.
- **IDOR/tenant hopping**: `create_payment_for_order`/`apply_payment_update`
  sempre confirmam que o `order_id` pertence ao `tenant_id` informado —
  testado com um pedido de tenant B sendo rejeitado/ignorado quando
  chamado com o tenant A.
- **Privilege escalation**: `payments.manage` restrito a OWNER/ADMIN,
  testado que MANAGER/OPERATOR não conseguem inserir em
  `store_payment_providers`.
- **Webhook forgery/replay**: assinatura verificada antes de qualquer
  parsing; `(provider, event_id)` único testado rejeitando entrega
  duplicada no nível do banco.
- **Payment duplication/amount manipulation**: `payments.unique(order_id)`
  testado — uma segunda tentativa de `create_payment_for_order` para o
  mesmo pedido atualiza a mesma linha, nunca cria uma segunda; valor
  sempre lido de `orders.total`, nunca aceito como parâmetro do cliente
  em nenhuma função (a assinatura delas nem tem esse parâmetro).
- **Order manipulation**: `orders.status` só avança para `PAID` dentro
  de `apply_payment_update` (`service_role`-only), nunca pelo checkout.
- **Provider account manipulation**: `connected_account_id` do webhook é
  cruzado contra `store_payment_providers` já gravado na conexão OAuth,
  nunca aceito solto.
- **`service_role` abuse/RLS bypass**: ver seção acima — uso narrow,
  documentado, sem contornar validação de negócio.
- **XSS/SQL injection**: toda escrita via parâmetro de função (nunca
  concatenação); renderização via JSX; grep dedicado confirmou zero
  `dangerouslySetInnerHTML`.

Nenhuma vulnerabilidade encontrada exigiu correção depois de escrita —
os pontos mais delicados (exceção em `log_audit` para ator anônimo,
separação `payments.amount` nunca vindo do cliente, vault sem nenhuma
RLS policy) foram desenhados corretamente desde a primeira versão,
seguindo diretamente o que a arquitetura já especificava em §11/§11.1.

## Estratégia de idempotência

`(provider, event_id)` único em `payment_webhook_events`
(insert-or-ignore real); `unique(order_id)` em `payments` (uma linha por
pedido, upsert em vez de duplicar); `create_payment_for_order` rejeita
se o pedido já está `APPROVED`; `apply_payment_update` reaplicado com o
mesmo resultado final não duplica nada (testado explicitamente, duas
chamadas seguidas com o mesmo evento).

## Status de pagamento vs. status do pedido

Colunas separadas, nunca uma substituindo a outra (prompt §9):
`payments.status`/`orders.payment_status` (`PENDING`/`APPROVED`/
`REJECTED`/`CANCELLED`/`REFUNDED`) vs. `orders.status`
(`PENDING`/`PAID`). Só `apply_payment_update` (webhook, `service_role`)
escreve nas duas; o checkout nunca marca um pedido como pago só porque o
cliente voltou para a página de confirmação — ela sempre mostra o status
real, lido do banco.

## Testes

`tests/unit/oauth-state.test.ts` (6), `tests/unit/mercadopago-gateway.test.ts`
(16 — assinatura de webhook, parsing de evento, `fetch` mockado para
OAuth/preference/consulta de pagamento, mapeamento de status),
`tests/unit/mask-account-id.test.ts` (3). `tests/integration/payments.test.ts`
(20 cenários) — RLS/trigger/RPC/vault reais contra Postgres: matriz de
permissões, conexão duplicada bloqueada, vault sem acesso nenhum para
`anon`/`authenticated`, round-trip completo de armazenar/ler/apagar
credencial via `service_role` (sem deixar segredo órfão numa
reconexão), valor sempre de `orders.total`, pedido já pago não é pago de
novo, tenant hopping bloqueado em duas funções diferentes, pagamento
duplicado bloqueado pela constraint, aprovação separa `payment_status`
de `orders.status`, rejeição nunca marca como pago, idempotência real
(mesmo evento duas vezes), valor divergente é ignorado, funções
`anon`-only e `service_role`-only testadas nos dois sentidos, auditoria
sem token/segredo.

Note-se que testes de fluxo Next.js (Server Action/Route Handler
executados de ponta a ponta) continuam fora do padrão deste projeto
(mesma decisão de todas as etapas anteriores) — a camada de banco é a
autoridade final testada; a orquestração em TypeScript (`checkout.ts`,
os dois Route Handlers) foi validada por `npm run build` + revisão de
código, não por invocação direta em teste.

**Total da suíte: 230/230 testes passando** (187 da Etapa 10 + 25
unitários + 20 de integração, novos — mais 2 testes pré-existentes cujo
fixture de env precisou ganhar as 4 variáveis novas, sem mudança de
comportamento).

## Limitações

- Postgres real + stub, não Supabase real (vault/pgsodium — ver
  ressalva no topo).
- Nenhuma chamada real ao Mercado Pago foi executada (sem credenciais).
- Renovação automática de `refresh_token` (job server-side) não
  implementada — desconexão manual quando o token expira/é revogado
  também não implementada (a UI mostraria "conectado" mesmo que o token
  tenha expirado no Mercado Pago, até a próxima tentativa de uso
  falhar).
- Revogação do lado do Mercado Pago no "desconectar": não implementada
  — o Mercado Pago não expõe um endpoint de revogação de token OAuth tão
  direto quanto outros provedores; desconectar remove a credencial do
  lado da VEXO imediatamente, mas a autorização concedida na própria
  conta MP só é revogada se o lojista revogar por lá.

## Decisões pendentes

- Job de renovação/expiração de token (arquitetura §11.1, "rotação de
  refresh_token é operacional").
- Múltiplas tentativas de pagamento por pedido (hoje: uma linha por
  pedido, upsert) — se o produto precisar de histórico completo de
  tentativas, é uma migration incremental (`payments` deixa de ter
  `unique(order_id)`), não um redesenho.
- Revogação do token no próprio Mercado Pago ao desconectar.
- PagBank/Asaas/Stripe — a abstração já está pronta (`lib/payments/gateway.ts`),
  só falta a implementação de cada um.

## Funcionalidades deliberadamente NÃO implementadas

Frete/Correios/transportadoras, cupons/descontos/cashback, assinatura
paga da VEXO, cobrança recorrente da VEXO, domínio personalizado, painel
MASTER completo, relatórios avançados, IA, API pública, outros gateways
em produção — todas fora do escopo por instrução explícita do prompt
desta etapa.
