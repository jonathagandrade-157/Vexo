# VEXO

SaaS multi-tenant para criação e operação de lojas virtuais. O lojista gerencia catálogo, aparência, equipe, entrega, pagamentos e pedidos; o cliente final compra em uma vitrine pública própria da loja.

## Stack

- Next.js 16, React 19 e TypeScript
- Tailwind CSS
- Supabase Auth, Postgres, Storage e RLS
- Mercado Pago para pagamentos do cliente final
- Melhor Envio para cotações de frete
- Asaas como fundação de billing da assinatura VEXO
- Resend para e-mail transacional
- Sentry para observabilidade
- Vitest para testes unitários e de integração

## Desenvolvimento local

Requisitos: Node.js 20 ou superior, npm e um projeto Supabase compatível com as migrations em `supabase/migrations`.

1. Copie `.env.example` para `.env.local`.
2. Preencha apenas as integrações necessárias ao fluxo que será testado. Nunca versione secrets.
3. Instale e execute:

```bash
npm ci
npm run dev
```

O app fica disponível em `http://localhost:3000`.

## Verificação

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Os testes que usam Postgres real são opt-in localmente:

```bash
npm run db:test:reset
RUN_INTEGRATION_TESTS=1 npm test
```

No GitHub Actions, o Postgres de teste, todas as migrations e `RUN_INTEGRATION_TESTS=1` já são configurados automaticamente.

Os smoke tests de navegador usam Chromium em desktop e mobile. Para testar um deploy já publicado em vez de iniciar o servidor local, informe `E2E_BASE_URL`.

## Áreas principais

- `/` — landing page
- `/cadastro` e `/login` — autenticação e trial
- `/onboarding` — configuração inicial da loja
- `/painel` — operação do lojista
- `/loja/[slug]` — storefront público
- `/master` — administração da plataforma
- `/api/health` — smoke test do deploy

## Integrações e secrets

A lista completa e os comentários de uso vivem em `.env.example`. As variáveis são validadas por domínio de integração em `lib/env.ts`, para que uma integração opcional ausente não derrube fluxos independentes.

Para produção, configure os valores diretamente na Vercel e nos respectivos provedores. Não copie credenciais reais para documentação, testes, issues ou commits.

## Arquitetura

A documentação detalhada está em `docs/architecture`. As regras centrais são:

- tenant resolvido no servidor, nunca confiado a partir do navegador;
- RLS como última camada de isolamento;
- valores de preço, estoque, frete e pagamento recalculados no servidor;
- credenciais de gateway nunca expostas ao cliente;
- falhas de integrações auxiliares, como e-mail, não bloqueiam o checkout.

## Estado do produto

O núcleo de catálogo, storefront, carrinho, checkout e pedidos está implementado. Clientes, Marketing, VEXO AI, suporte e a interface self-service de assinatura permanecem explicitamente sinalizados como etapas futuras. O status de execução e critérios de aceite são acompanhados no projeto VEXO do Linear.
