# Homologação isolada: configuração e aceite

Inventário de nomes reconferido em 05/11/2026. Nenhum valor foi baixado ou alterado.
Preview Vercel do projeto `vexo.ecommerce` contém entradas compartilhadas
Production/Preview de Supabase legado, Mercado Pago, TRIAL_HASH_SECRET e
OAUTH_STATE_SECRET. Não há modo de teste MP nem URL explícita de homologação.
**Não executar testes financeiros nesse Preview.** Presença de nomes não
comprova validade das credenciais, conta de teste ou isolamento do banco.

## Configurar antes do primeiro teste externo

Separar projeto/branch Supabase e deployment estável de homologação, sem dados
reais. Provisionamento, custos e alteração das variáveis exigem aprovação.
Na Vercel, Settings → Environment Variables, escopo Preview restrito à branch
de homologação: substituir a associação compartilhada por entradas próprias.
Nomes NEXT_PUBLIC são incorporados no build e exigem rebuild.

| Nome | Tipo e destino | Evidência esperada |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Config pública; projeto isolado | Ref diferente da produção |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Config pública; key emitida pelo projeto isolado | Login/SSR/browser com chaves legadas ausentes |
| SUPABASE_SECRET_KEY | Secret; servidor | Carrinho/checkout/RPC com RLS público preservado |
| TRIAL_HASH_SECRET | Secret exclusivo da homologação | Documento sintético como HMAC; trial único |
| NEXT_PUBLIC_SITE_URL | Config; URL HTTPS estável de homologação | Redirects/callbacks no mesmo ambiente |
| NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX | Config; sufixo de homologação | URLs da vitrine apontam ao destino aprovado |
| MERCADO_PAGO_CLIENT_ID | Config identificadora da aplicação de teste | Aplicação/contas de teste do proprietário conferidas |
| MERCADO_PAGO_CLIENT_SECRET | Secret; aplicação de teste | Troca OAuth PKCE no sandbox autorizado |
| MERCADO_PAGO_WEBHOOK_SECRET | Secret; assinatura daquela aplicação | Assinatura válida aceita; falsa rejeitada |
| MERCADO_PAGO_TEST_MODE | Config `true`, obrigatório | Nenhum pagamento live na homologação |
| OAUTH_STATE_SECRET | Secret único para homologação | State assinado, expirado/reutilizado rejeitado |
| ASAAS_API_KEY | Secret; conta sandbox | API reconhece conta sandbox aprovada |
| ASAAS_API_URL | Config `https://sandbox.asaas.com/api/v3` | Todas as chamadas permanecem no sandbox |
| ASAAS_WEBHOOK_TOKEN | Secret; webhook sandbox | Token correto aceito, errado rejeitado |
| RESEND_API_KEY | Secret; emissor de teste | Entrega sintética autorizada e erro observado |
| EMAIL_FROM | Config; remetente aprovado/verificado | Mensagem recebida e identificação correta |
| CRON_SECRET | Secret; exclusivo desse ambiente | Job autenticado; chamada anônima negada |
| NEXT_PUBLIC_SENTRY_DSN | Config pública; projeto/ambiente de homologação | Erro sintético sanitizado recebido |
| SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN | Config/config/secret de build | Sourcemaps privados e evento sem PII |

Não enviar valores por chat. Configurar diretamente no cofre/Vercel. SMTP
do Supabase Auth é configuração separada (Authentication → Email/SMTP);
RESEND_API_KEY da aplicação não ativa confirmação de cadastro no Auth.
Definir Site URL/redirect allowlist e template de confirmação compatíveis com
o fluxo implementado. Jornadas com confirmação habilitada estão implementadas
na stack local/Mailpit; entrega SMTP externa segue pendente. Procedimento em
[auth-email-release.md](auth-email-release.md).

## Endpoints existentes e autorização de execução

Mercado Pago: registrar callback
`https://HOST-HOMOLOGACAO/api/oauth/mercadopago/callback` e webhook
`https://HOST-HOMOLOGACAO/api/webhooks/mercadopago` na aplicação de teste.
Asaas: webhook `https://HOST-HOMOLOGACAO/api/webhooks/asaas`, com o token
configurado nesse ambiente. Não apontar webhooks de teste para produção.

O pedido atual autoriza homologar os fluxos utilizados em sandbox, sem dinheiro
real. Isso não autoriza usar as credenciais compartilhadas com produção,
provisionar serviços pagos ou enviar comunicações a destinatários não definidos.
Faltam ambiente isolado e contas/credenciais de teste configuradas no cofre.
O OAuth antes proibido não foi iniciado; confirmar a conta de teste e seu
escopo antes do vínculo. Nenhuma operação financeira externa foi executada.
Testes unitários/PostgreSQL com mocks não
substituem recibo/ID do evento sandbox e correlação com o estado no VEXO.

## Matriz de aceite financeiro

| Fluxo | Evidência mínima da homologação externa |
| --- | --- |
| MP OAuth | Vínculo de conta de teste, retorno/PKCE/state e token no Vault recuperável |
| MP PIX/cartão | Aprovado e recusado, sem valores reais; payment ID/test mode e pedido correlacionados |
| MP webhook | Assinatura real, repetição/atraso sem duplicar transição/estoque |
| MP cancelamento/reembolso | Estado no provedor reconciliado com pedido e histórico |
| Asaas criação/ativação | Uma assinatura/cobrança, ativação só por confirmação válida |
| Asaas renovação/falha | Datas e inadimplência/bloqueio conforme regra atual, sem cobrança duplicada |
| Asaas upgrade/downgrade | Plano/limites/valor e vigência coerentes no provedor e banco |
| Asaas cancelamento/reativação | Cobrança futura e acesso conforme política, histórico auditável |
| Asaas duplicação/reconciliação | Mesmo evento repetido mantém saldo e estado; falha/retry não duplica cobrança |

Para cada linha: commit/deployment, conta sandbox (ID, nunca token), request/
event ID, horário, status, linhas sintéticas afetadas e evidência sanitizada.
Atualmente as linhas externas estão **pendentes**, não homologadas.

### Evidência controlada disponível em 05/11

Mercado Pago recebe pagamentos de pedidos das lojas; Asaas trata cobrança e
assinatura dos lojistas pelo SaaS. Não misturar credenciais nem interpretar
o recebimento de um pedido como quitação da assinatura.

Na revisão `27fc263`, o job principal do CI 42111772873 aprovou as suítes
existentes com mocks de HTTP e PostgreSQL real. Elas verificam assinatura e
payload do webhook MP, vínculo de tenant/pedido/moeda/vendedor/valor,
duplicidade, retry em timeout/erro de banco, OAuth state/PKCE e reconciliação.
Para Asaas verificam autenticação do webhook, confirmação/falha/estorno,
assinatura, duplicidade e erros; o adaptador cobre create/update/cancel e
normalização de planos. Isso não comprova execução no sandbox dos provedores.

Arquivos de evidência: `tests/unit/mercadopago-webhook-route.test.ts`,
`mercadopago-oauth-callback-route.test.ts`, `mercadopago-gateway.test.ts`,
`asaas-webhook.test.ts`, `asaas-gateway.test.ts` e integrações
`billing-webhook-event.test.ts`, `payments.test.ts`,
`reconcile-stale-payments.test.ts`. Não foi necessário repetir essas suítes
isoladamente depois do job verde da mesma revisão.

Pendência técnica específica para homologação Asaas: o parser de dateCreated
assume -03:00 para o formato sem offset. A documentação oficial consultada
em 05/11 mostra esse formato, mas não esclarece o fuso nessa página; não
declarar a hipótese confirmada. Conferir evento sandbox com horário conhecido
ou obter confirmação do provedor antes do aceite da ordenação de eventos.
[Formato oficial do evento](https://docs.asaas.com/docs/eventos-de-webhooks).

## Primeira venda: operação humana pendente

Consulta read-only de 29/10 confirmou três planos ativos em produção:
Básico R$19,90/mês, Intermediário R$49,99/mês e Pro R$89,90/mês; trial de
30 dias em todos, preço anual nulo. A landing usa `listPublicPlans`, a mesma
tabela de planos ativos, e filtra recursos públicos por allowlist. Isso
confirma cadastro/fonte de preços; não comprova contratação ou cobrança.
Não divulgar anual enquanto não houver preço/ciclo aprovado e homologado.
Limites observados: Básico 50 produtos/10 categorias, Intermediário 500/50,
Pro ilimitado (-1). Existe chave adicional legada `products=50` no Básico;
o código de enforcement usa `products_limit=50`. Não foi alterada nem removida.

`/painel/suporte` atualmente é ComingSoon. Não é defeito de um módulo
prometido neste escopo, mas falta um canal externo real para operar a primeira
venda. Termos/privacidade publicados dizem apenas "canais oficiais" sem
identificar esse contato. O proprietário deve definir canal, responsável e
procedimento de solicitações; não inventar e-mail/telefone nem abrir novo
sistema de chamados. Não existe evidência de revisão jurídica humana aceita.

Confirmar destinatário/canal de suporte e horário de atendimento; domínio
remetente e SMTP; alertas com responsável; revisão humana dos termos,
privacidade, cancelamento e retenção; planos/limites divulgados iguais aos
cadastrados. Ensaio de incidentes e alerta de backup/webhooks precede GO
comercial. Nenhuma conformidade jurídica é declarada por testes automatizados.
