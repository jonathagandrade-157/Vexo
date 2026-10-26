# Homologação isolada do Mercado Pago

Este roteiro prepara a validação externa posterior da Etapa 2A.3. Ele não autoriza deploy, chamada ao Mercado Pago, cobrança real ou uso de credenciais de produção.

## Ambiente obrigatório

Configure os valores diretamente no ambiente isolado (por exemplo, um ambiente local HTTPS ou um projeto de homologação separado). Nunca cole segredos em issue, chat, log, commit ou captura de tela.

| Variável | Valor esperado na homologação | Observação |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | URL HTTPS pública e isolada | Origem exata usada no callback e nas notificações. |
| `MERCADO_PAGO_CLIENT_ID` | Client ID de teste da aplicação | Não usar o valor de produção. |
| `MERCADO_PAGO_CLIENT_SECRET` | Client secret de teste | Segredo somente de servidor. |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Assinatura secreta do webhook de teste | Segredo somente de servidor. |
| `MERCADO_PAGO_TEST_MODE` | `true` | Faz a troca OAuth solicitar `test_token`. |
| `OAUTH_STATE_SECRET` | Valor aleatório exclusivo do ambiente | No mínimo 16 caracteres; não reutilizar produção. |

O fluxo não aceita um `MERCADO_PAGO_ACCESS_TOKEN` estático. O token do vendedor é obtido por OAuth, armazenado cifrado no vault do banco e associado ao tenant e ao `connected_account_id`.

## URLs da aplicação Mercado Pago

- Redirect URI: `<NEXT_PUBLIC_SITE_URL>/api/oauth/mercadopago/callback`
- Webhook: `<NEXT_PUBLIC_SITE_URL>/api/webhooks/mercadopago`
- Evento necessário: pagamentos.

As URLs precisam ser HTTPS, públicas apenas durante a homologação e pertencer ao ambiente isolado. Não aponte a aplicação de teste para produção.

## Contas e dados de teste

1. Crie usuários de teste vendedor e comprador no mesmo país.
2. Conecte a conta do vendedor pelo painel da VEXO.
3. Confirme no banco isolado que `store_payment_providers.live_mode = false` e que o `connected_account_id` corresponde ao vendedor de teste.
4. Use somente cartões e dados de teste fornecidos pelo Mercado Pago.
5. Não use conta pessoal, cartão real, CPF real ou credencial `APP_USR` como prova de sandbox. O prefixo do token, sozinho, não determina o modo.

## Casos de homologação

Para cada caso, registre somente identificadores de teste, horário, status HTTP e resultado; masque e-mail e qualquer dado pessoal.

1. OAuth autorizado: callback único, cookie consumido, PKCE aceito, `live_mode=false`.
2. OAuth negado, expirado e repetido: conexão não criada.
3. Pagamento aprovado: pedido correto passa para `APPROVED`/`PAID` uma vez.
4. Pagamento recusado e cancelado: estado correspondente sem afetar outro tenant.
5. Entrega duplicada do webhook: nenhuma segunda transição ou efeito colateral.
6. Evento fora de ordem: `APPROVED` não volta para `PENDING`, `REJECTED` ou `CANCELLED`; `REFUNDED` continua permitido.
7. Assinatura ausente ou inválida: HTTP 401 e nenhuma escrita.
8. Identidade divergente (moeda, vendedor, pedido, tenant ou valor): evento não aplicado nem marcado como processado.
9. Timeout/erro transitório do provedor: HTTP 503, evento pendente para retry e reconciliação disponível.
10. Criação repetida do checkout: mesma chave de idempotência por pedido e nenhuma cobrança duplicada.

## Evidências mínimas

- ID de teste do pagamento e do evento (não tokens).
- ID interno do pedido e tenant de teste.
- Status final no Mercado Pago e no banco isolado.
- Resposta do webhook e indicação de `processed_at`.
- Evidência de uma entrega duplicada sem efeito adicional.
- Evidência de ausência de deploy, migrations remotas e credenciais de produção.

Depois da homologação, revogue/rotacione os segredos temporários e remova a exposição pública do ambiente isolado.
