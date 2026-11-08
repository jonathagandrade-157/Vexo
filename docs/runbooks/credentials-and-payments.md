# Credenciais, separação Preview × Produção e pagamentos

Atualizado em 08/11/2026. Somente **nomes** de variáveis aparecem aqui;
valores vivem apenas no painel do provedor e no cofre da Vercel, copiados
diretamente de um para o outro — nunca em chat, commit, issue ou log.
Este documento não autoriza nenhuma alteração; cada passo 🔒 exige GO.

## Estado conferido (somente nomes, Vercel, 08/11)

| Variável | Production | Preview | Observação |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | ✓ mesma | Preview aponta para o banco de produção |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legada) | ✓ | ✓ mesma | `anon` legada ativa no Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` (legada) | ✓ | ✓ mesma | **Preview tem acesso administrativo à produção** |
| `TRIAL_HASH_SECRET` | ✓ | ✓ mesma | também raiz das chaves derivadas (cookie, token de pedido) |
| `MERCADO_PAGO_CLIENT_ID/SECRET/WEBHOOK_SECRET` | **vazias** | vazias | 673 erros/7 dias no cron e na tela de pagamentos |
| `OAUTH_STATE_SECRET` | ✓ | ✓ mesma | precisa ser distinto por ambiente |
| `NEXT_PUBLIC_SITE_URL` | ✓ | — | Preview deriva de `VERCEL_URL` |
| `RESEND_API_KEY`, `SENTRY_*`, `NEXT_PUBLIC_SENTRY_DSN` | ✓ | — | |
| `CRON_SECRET` | ✓ (tipo *encrypted*, alerta `readable-secret`) | — | converter para *Sensitive* |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | **ausentes** | ausentes | chaves modernas já existem no Supabase |
| `MERCADO_PAGO_TEST_MODE`, `ASAAS_*`, `ORDER_ACCESS_SECRET` | ausentes | ausentes | |

Proteção em código desde esta entrega: um Preview cujo
`NEXT_PUBLIC_SUPABASE_URL` seja o projeto de produção **não recebe segredos
de servidor** (`assertNotPreviewOnProductionData`, `lib/env.ts`). Isso
impede gravações administrativas a partir de Previews, mas não substitui a
separação abaixo: Previews ainda usam a chave pública de produção para
login/cadastro no Auth de produção.

## Separar Preview de Produção

Passo A — imediato, independente da homologação hospedada (🔒):
1. Na Vercel, remover o alvo **Preview** de `SUPABASE_SERVICE_ROLE_KEY`,
   `TRIAL_HASH_SECRET`, `OAUTH_STATE_SECRET` e `MERCADO_PAGO_*` (manter só
   Production). Não editar valores; apenas o escopo.
2. Remover também `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   do alvo Preview. Previews deixam de funcionar até o passo B — preferível a
   operar sobre dados reais.

Passo B — homologação hospedada (depende do projeto Supabase de homologação):
1. Valores **do projeto de homologação** no alvo Preview (todas as branches)
   ou só na branch `homolog` (variável de Preview específica de branch):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, `TRIAL_HASH_SECRET` novo, `OAUTH_STATE_SECRET` novo,
   `ORDER_ACCESS_SECRET` novo, `NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX` de teste.
2. Nunca colocar no Preview: `RESEND_API_KEY` de produção, `CRON_SECRET` de
   produção, credenciais Mercado Pago/Asaas de produção, `VERCEL_API_TOKEN`.
3. Rotinas automáticas: os crons do `vercel.json` só rodam no deployment de
   **Production** (documentação Vercel); Previews não reconciliam pagamentos.
4. Projeto de homologação no Supabase: Site URL e Redirect URLs apenas da
   URL de homologação; SMTP de teste (ou o remetente padrão com limite) —
   nunca o domínio de produção; buckets criados pelas próprias migrations;
   aplicar as 128 migrations com `supabase db push` **vinculado ao projeto
   de homologação**, nunca ao de produção; dados só sintéticos.

## Mercado Pago sandbox (homologação)

Ver também [mercado-pago-sandbox.md](mercado-pago-sandbox.md). Necessário:
- Aplicação de teste no painel do Mercado Pago do proprietário, com usuários
  de teste vendedor e comprador (cartões de teste oficiais).
- Variáveis no ambiente de homologação: `MERCADO_PAGO_CLIENT_ID`,
  `MERCADO_PAGO_CLIENT_SECRET`, `MERCADO_PAGO_WEBHOOK_SECRET` (da aplicação de
  teste), `MERCADO_PAGO_TEST_MODE=true`, `OAUTH_STATE_SECRET` exclusivo.
- URLs na aplicação de teste: redirect OAuth
  `<URL de homologação>/api/oauth/mercadopago/callback`; notificações
  `<URL de homologação>/api/webhooks/mercadopago`.
- Aceite: OAuth com conta de teste; PIX e cartão aprovado/recusado; webhook
  assinado aceito e falso rejeitado; repetição sem duplicar; retorno do
  checkout abre a confirmação (o `back_url` leva `?acesso=`); cancelamento e
  reembolso reconciliados; cron reconcilia pagamento atrasado.

## Troca e revogação das chaves Supabase legadas

Procedimento completo e probes em [supabase-key-rotation.md](supabase-key-rotation.md);
ordem dentro do release em [controlled-release.md](controlled-release.md).
Pré-requisito: Passo A concluído (senão Previews continuam usando a legada).

## O que é preciso para o hotfix × para começar a vender

| Requisito | Hotfix técnico (carrinho, exposições, equipe) | Iniciar vendas | Billing VEXO (cobrar lojistas) |
| --- | --- | --- | --- |
| CI + homologação de rollout verdes no SHA | Obrigatório | Obrigatório | Obrigatório |
| Backup da janela com readback | Obrigatório | Obrigatório | Obrigatório |
| Piloto de restore aceito (B2) | Recomendado | **Obrigatório** | Obrigatório |
| 5 migrations do release | Obrigatório | Obrigatório | Obrigatório |
| Preview separado (Passo A) | Obrigatório | Obrigatório | Obrigatório |
| Chaves modernas + revogação das legadas | Configurar no release; revogar logo após | **Revogação comprovada** | Revogação comprovada |
| Mercado Pago | Não (checkout WhatsApp funciona sem MP) | Credenciais de produção + sandbox aceito | — |
| E-mail transacional (Resend domínio verificado, `EMAIL_FROM`) | Não | Obrigatório | Obrigatório |
| Supabase Auth: SMTP próprio, confirmação de e-mail, senhas vazadas | Não | Obrigatório | Obrigatório |
| CAPTCHA (decisão pendente) | Não | Decidir antes | Decidir antes |
| Expiração de reservas WhatsApp (decisão pendente) | Não | Decidir antes | — |
| Asaas: `ASAAS_API_KEY`, `ASAAS_API_URL`, `ASAAS_WEBHOOK_TOKEN` (sandbox, depois produção) | Não | Não | Obrigatório + homologação da matriz Asaas |
| RPCs de billing só no servidor (P2 da auditoria) | Não | Não | Obrigatório |
| Suporte, alertas e responsáveis | Não | Obrigatório | Obrigatório |
| Revisão humana das políticas (termos/privacidade) | Não | Obrigatório | Obrigatório |
