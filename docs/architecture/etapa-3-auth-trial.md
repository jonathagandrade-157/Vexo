# Etapa 3 — Autenticação, Criação de Conta e Elegibilidade de Trial

> Documentação curta desta etapa. Para o desenho completo ver
> `docs/architecture/vexo-arquitetura-tecnica.md` (§7, §13, §25) e
> `docs/architecture/etapa-2-multi-tenant-rls.md` (base multi-tenant sobre a
> qual esta etapa é construída, sem alterações de comportamento).

## Fluxo completo

```
/cadastro (form)
  → Zod valida (allowlist de campos, dígito verificador de CPF/CNPJ)
  → hashDocument(document, TRIAL_HASH_SECRET)   [só no servidor]
  → supabase.auth.signUp({ email, password })   [Supabase Auth real]
  → UPDATE profiles SET full_name, phone, cpf_hash   [RLS: só a própria linha]
  → RPC create_tenant(storeName, slug)           [Etapa 2, inalterado]
  → RPC start_trial_for_tenant(userId, tenantId, documentHash)  [service_role]
       ├─ elegível  → INSERT trial_eligibility + trial_records
       │              → redirect /trial/sucesso?tenant=<id>
       └─ já usado  → SQLSTATE VX001 → redirect /trial/ja-utilizado
```

`/login` (sem tela no Stitch — mesmo padrão visual) usa
`supabase.auth.signInWithPassword`. `proxy.ts` agora refresca a sessão em
toda request (extensão que a Etapa 1 já reservava como "Stage 3").

## Tabelas/migrations (Etapa 3)

- `trial_eligibility` (`document_hash` único) — sem nenhuma policy/GRANT de
  leitura ou escrita para `anon`/`authenticated`/`service_role`; só
  `start_trial_for_tenant()` (dono da função) toca nela.
- `trial_records` (`tenant_id` único, `started_at`/`ends_at`/`status`) —
  `SELECT` para membros do tenant e platform admins; escrita só via a mesma
  função. Sem `converted_plan_id`/`converted_at` ainda (não há tabela
  `plans` até a Etapa 8).
- `start_trial_for_tenant(p_user_id, p_tenant_id, p_document_hash)` —
  **service_role-only** (ver §"Proteção contra reutilização" abaixo).

## Regras de elegibilidade

Um `document_hash` (HMAC-SHA256 do CPF/CNPJ normalizado,
`TRIAL_HASH_SECRET`) só pode aparecer em **uma** linha de
`trial_eligibility`, para sempre. A checagem acontece **depois** do
`signUp()`, não antes — de propósito: checar antes exigiria uma RPC
chamável por `anon` só para "isso já foi usado?", que seria uma superfície
de sondagem. Checar depois do login já ter uma sessão evita essa
superfície inteira, ao custo aceito de uma conta Supabase Auth poder ficar
sem tenant/trial se o passo seguinte falhar (ver riscos no relatório).

## Proteção contra reutilização (e contra manipulação de requisição)

Isto foi corrigido **durante** esta etapa, a partir de um teste de
integração que realmente tentou o ataque, não de revisão estática:

- **v1 (com falha)**: `start_trial_for_tenant(p_tenant_id, p_document_hash)`
  aceitava o hash como parâmetro e dava `EXECUTE` a `authenticated`. Como
  qualquer parâmetro de uma função chamável por `authenticated` é, por
  definição, escolhido por quem chama, nada impedia pular a Server Action e
  chamar a função via RPC direto com uma string qualquer como "hash" — nem
  precisava ser um HMAC de verdade, bastava nunca repetir a mesma string.
  Isso derrotava a regra de "um trial por documento" por completo.
- **v2 (corrigida)**: a função virou **service_role-only** — só o próprio
  servidor Next.js (que calculou o hash a partir de um CPF/CNPJ real,
  validado por dígito verificador) pode chamá-la, nunca o browser. Como não
  há JWT de usuário numa chamada `service_role`, `p_user_id` passou a ser
  explícito — mas só a Server Action decide esse valor, depois de já ter
  confirmado a sessão via `supabase.auth.getUser()`.
- **Achado relacionado**: `revoke all on function ... from public` sozinho
  **não** bastava para tirar o acesso de `authenticated`/`anon` — o
  Supabase concede `EXECUTE` em toda função nova de `public` diretamente a
  esses papéis por padrão (`ALTER DEFAULT PRIVILEGES`), e revogar só do
  pseudo-papel `PUBLIC` não toca nesses GRANTs diretos. Corrigido nesta
  função **e**, por precaução (mesmo não sendo explorável lá, porque
  `create_tenant()` já rejeitava `auth.uid()` nulo), em
  `public.create_tenant()` também.
- Teste correspondente:
  `tests/integration/trial-eligibility.test.ts` → "authenticated cannot
  call start_trial_for_tenant directly".

Camadas restantes, todas testadas:
`tenants.created_by = p_user_id` (só quem criou o tenant inicia o trial
dele) · `trial_records.tenant_id` único (um trial por tenant) ·
`trial_eligibility.document_hash` único (um trial por documento, garantia
final mesmo sob corrida) · `profiles.cpf_hash` único (Etapa 2 — mesmo
documento não pode virar dois profiles).

## Componentes/telas criadas

`app/(auth)/cadastro` (`criar_conta_e_elegibilidade_trial`),
`app/(auth)/login` (sem referência no Stitch — mesmos tokens),
`app/(auth)/trial/sucesso` (`inicio_do_trial_sucesso`),
`app/(auth)/trial/ja-utilizado` (`erro_trial_ja_utilizado`).
Compartilhado: `components/ui/{text-field,submit-button,brand-mark}.tsx`.

Duas mudanças de conteúdo (não de estrutura/tokens) em relação ao mockup,
porque o texto original ficaria impreciso frente ao que o produto
realmente faz nesta etapa: o bloco "Plano Ativo: PRO / AI ENABLED" virou
"Plano: Teste / GRÁTIS" (não existe tabela `plans` nem recurso de IA
ainda); "30 dias" no card e no disclaimer é calculado a partir do
`trial_records` real, não fixo.

## Critérios de aceite

Ver relatório final — lint/typecheck/build/testes verdes, os 3 fluxos
(elegível, não-elegível, tentativa de reuso/manipulação) cobertos por
teste de integração real contra Postgres, build gera as 4 rotas.
