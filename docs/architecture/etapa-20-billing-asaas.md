# Etapa 20.2.5 — Cliente Asaas isolado do Billing

> Documentação curta desta etapa. Para o desenho completo do schema/fluxo
> de billing ver os relatórios das Etapas 20.2.1 (auditoria), 20.2.2
> (decisão comercial/gateway) e 20.2.3 (desenho técnico) — não
> reproduzidos aqui. Esta etapa entrega só a camada de comunicação
> isolada com o Asaas: sem checkout, sem `/painel/assinatura`, sem Server
> Action de assinatura, sem webhook, sem cobrança real.

## Ressalva antes de qualquer coisa

Sem credenciais reais do Asaas neste ambiente — todo o código fala com os
endpoints REAIS documentados publicamente pelo Asaas (chamadas `fetch` de
verdade, nunca simuladas), mas nada foi executado contra o sandbox/
produção deles. Confirmado nesta etapa via pesquisa na documentação
oficial: autenticação, endpoints de Customer/Subscription/Payment,
formato de erro, e a lista de eventos de webhook (para referência futura
— o webhook em si não é implementado agora). **Não confirmado**: a URL
exata de produção (só a de sandbox veio explícita na pesquisa) e se o
payload clássico de webhook do Asaas carrega um id de evento estável e
distinto do id do payment/subscription — ambos precisam ser reconferidos
contra a documentação oficial atual antes da Etapa 20.2.6/produção.

## Billing × Payments — por que são duas camadas nunca compartilhadas

| | `lib/payments/*` (Etapa 11) | `lib/billing/*` (Etapa 20.2.5) |
|---|---|---|
| Quem paga | Cliente final da loja | O lojista |
| Quem recebe | A conta Mercado Pago do lojista | A conta Asaas da VEXO |
| Credencial | Token OAuth por tenant (`payment_credentials_vault`) | 1 API key própria da VEXO (`ASAAS_API_KEY`) |
| Tabelas | `payments`, `store_payment_providers` | `billing_invoices`, `billing_webhook_events`, `subscriptions.gateway_*` |
| Interface | `PaymentGateway` | `BillingGateway` (não estende nem reaproveita a outra) |

Nunca misturar: `lib/billing/asaas.ts` nunca importa nada de
`lib/payments/`, nunca lê `payment_credentials_vault`/
`store_payment_providers`, e a API key do Asaas nunca é uma credencial de
tenant — é sempre a conta única da VEXO.

## Arquitetura da camada

`lib/billing/gateway.ts` (interface `BillingGateway` + `BillingGatewayError`)
→ `lib/billing/asaas.ts` (única implementação real desta etapa) →
`lib/billing/registry.ts` (`getBillingGateway(provider)`, único ponto que
sabe instanciar cada provedor). Código futuro (Server Action de
assinatura, webhook) só importa a interface/registry — Stripe/Iugu/
Pagar.me/PagBank entram depois só com um novo arquivo `lib/billing/<provider>.ts`
+ um `case` no registry, sem tocar em mais nada.

`BillingProvider` é `"asaas" | "stripe" | "iugu" | "pagarme" | "pagbank"`
— o mesmo vocabulário exato do `CHECK` já em produção em
`subscriptions.gateway`/`billing_invoices.gateway`/
`billing_webhook_events.provider` (Etapa 20.2.4). Só `"asaas"` tem
adapter; os outros lançam erro explícito (`not implemented yet`) se
alguém tentar `getBillingGateway()` com eles.

## Métodos implementados (e por que não mais que isso)

`createCustomer`, `getCustomer`, `createSubscription`, `getSubscription`,
`updateSubscription`, `cancelSubscription`, `getPayment` — exatamente o
que o desenho aprovado da Etapa 20.2.3 (fluxo de 1ª assinatura, upgrade,
downgrade, cancelamento) precisa. **Sem `createPayment` avulso**: no
desenho aprovado, toda cobrança de billing nasce de uma Subscription —
nenhum fluxo cria uma cobrança solta. **Sem verificação/parse de
webhook**: fora do escopo desta etapa por definição (Etapa 20.2.5
§objetivo) — fica para a Etapa 20.2.6, que vai pesquisar o formato real
de payload antes de desenhar isso.

## Autenticação confirmada

Header `access_token` em toda requisição (não `Authorization: Bearer` —
mecanismo diferente do Mercado Pago). Sandbox: `https://sandbox.asaas.com/api/v3`.
Produção: reconfirmar a URL exata em
[docs.asaas.com/docs/sandbox](https://docs.asaas.com/docs/sandbox) antes
de configurar `ASAAS_API_URL` em produção.

## Variáveis de ambiente

`ASAAS_API_KEY`/`ASAAS_API_URL`, validadas em `lib/env.ts` por
`getBillingEnv()` — schema **separado** de `getServerEnv()`/
`getMercadoPagoEnv()` pelo mesmo motivo de sempre: nenhum fluxo essencial
(auth/cadastro/trial/checkout da loja) pode quebrar por o Billing ainda
não estar configurado. Só chamado por código que vai de fato acionar o
gateway de billing (`lib/billing/registry.ts`). Nunca `NEXT_PUBLIC_*`,
nunca lido fora do servidor (`getBillingEnv()` lança se `window` existir).

## Segurança

- `lib/billing/asaas.ts` tem `import "server-only"` — importar de um
  Client Component quebra o build, não é só uma convenção.
- A API key nunca é logada: `BillingGatewayError` só monta a mensagem a
  partir do status HTTP e da descrição devolvida pelo *corpo da resposta*
  do Asaas — nunca dos headers/corpo da requisição enviada. Testado
  explicitamente (`tests/unit/asaas-gateway.test.ts`, "API key never
  leaks") em todo caminho de erro (400/401/timeout/network/malformed).
- Timeout (10s por padrão, configurável) via `AbortController` — nenhuma
  chamada trava indefinidamente.
- Nenhum tenant pode escolher a API key/gateway a usar — `getBillingGateway()`
  só lê `ASAAS_API_KEY` do ambiente do servidor, nunca um parâmetro vindo
  de uma requisição.

## Como adicionar outro gateway no futuro

1. Criar `lib/billing/<provider>.ts` exportando `create<Provider>Gateway(...)`
   implementando `BillingGateway`.
2. Adicionar um `case` em `lib/billing/registry.ts`.
3. Adicionar o schema de env correspondente em `lib/env.ts` (mesmo padrão
   de `getBillingEnv()`).
4. Nenhuma migration nova: o banco já aceita os 5 providers desde a Etapa
   20.2.4.
