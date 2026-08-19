# Etapa 2 — Banco de Dados, Multi-Tenant, Autenticação e Autorização

> Documentação curta desta etapa (arquitetura §25 do prompt da Etapa 2). Para o
> desenho completo e o raciocínio de segurança por trás de cada decisão, ver
> `docs/architecture/vexo-arquitetura-tecnica.md` (§3, §5, §6, §8, §18.2, §25) —
> este documento não repete esse conteúdo, só resume o que foi efetivamente
> implementado e onde encontrar cada peça no código.

## Modelo multi-tenant

Um tenant = uma loja (`public.tenants`). Isolamento é por `tenant_id`, nunca por
nome/slug — `slug` é só cosmético/URL. O modelo é *single database, shared
schema*, com RLS como a fronteira de isolamento real (arquitetura §3.1).

## Relacionamento user → tenant → role

```
auth.users (Supabase Auth)
  └─ public.profiles            (1:1, criado por trigger no signup)
  └─ public.tenant_members      (N:N com tenants, via role_id)
        ├─ tenant_id  → public.tenants
        └─ role_id    → public.roles → public.role_permissions → public.permissions
```

Um usuário pode pertencer a múltiplos tenants (múltiplas linhas em
`tenant_members`, uma por tenant). `platform_admins` é uma tabela **separada**,
sem `tenant_id` — nunca confundir MASTER com um papel de `tenant_members`.

## Matriz de papéis (fixa, sem customização por tenant no MVP)

| Papel | products | orders | customers | settings | team | billing | support | reports |
|---|---|---|---|---|---|---|---|---|
| OWNER | view/create/update/delete | view/update | view/update | view/update | view/manage | view/manage | view/manage | view |
| ADMIN | view/create/update/delete | view/update | view/update | view/update | view/manage | — | view/manage | view |
| MANAGER | view/create/update/delete | view/update | view/update | — | — | — | — | — |
| OPERATOR | — | view/update | view | — | — | — | — | — |
| SUPPORT | — | — | — | — | — | — | view | — |

Seed exato em `supabase/migrations/20260817220003_roles_and_permissions.sql`.
Papéis customizáveis por tenant ficam fora do MVP (decisão confirmada,
arquitetura §25.4) — `roles` não tem coluna `tenant_id` especulativa; se essa
funcionalidade for aprovada, entra como uma migration aditiva própria.

## RLS

Toda tabela de negócio tem `ENABLE + FORCE ROW LEVEL SECURITY`. Nenhuma policy
usa `tenant_id` vindo do cliente — todas resolvem o tenant a partir de
`auth.uid()` através de `tenant_members`, via as funções `private.*`:

- `private.is_tenant_member(tenant_id)` — membro ativo do tenant.
- `private.has_role(tenant_id, role_key)` / `private.is_tenant_owner(tenant_id)`.
- `private.has_permission(tenant_id, permission_key)`.
- `private.is_platform_admin()` / `private.is_platform_support()`.

Todas `SECURITY DEFINER` com `search_path = ''` e nomes 100% qualificados
(arquitetura §14) — necessário para evitar recursão de RLS (uma policy de
`tenant_members` que dependesse de uma query direta em `tenant_members`
entraria em loop). Ver
`supabase/migrations/20260817220009_auth_helper_functions.sql`.

## Imutabilidade de `tenant_id` (proteção contra tenant hopping)

`private.prevent_tenant_id_change()` (migration `20260817220008`) é um
trigger `BEFORE UPDATE` genérico, anexado a toda tabela com `tenant_id`
(hoje: `tenant_members`) — rejeita incondicionalmente qualquer `UPDATE` que
mude o valor da coluna. Independente de RLS: mesmo `service_role` (que tem
`BYPASSRLS`) esbarra nele. Toda tabela `tenant_id`-scoped futura deve anexar o
mesmo trigger.

## `platform_admins`

Sem nenhuma policy de `INSERT`/`UPDATE`/`DELETE` para nenhum papel de
aplicação, **e** `REVOKE INSERT, UPDATE, DELETE` explícito de
`anon, authenticated, service_role` (migration `20260817220014`) — nem o
código server-side da própria aplicação consegue escrever aqui. Gestão só por
conexão direta ao banco (Supabase Studio/CLI administrativo), fora do fluxo da
aplicação, como exigido.

## `audit_logs`

Append-only garantido em duas camadas independentes (nenhuma delas sozinha
bastaria, porque `service_role` tem `BYPASSRLS`):

1. `REVOKE UPDATE, DELETE` da tabela para todos os papéis de aplicação.
2. Trigger `private.prevent_audit_log_mutation()` que rejeita incondicionalmente
   qualquer `UPDATE`/`DELETE`, mesmo que um `GRANT` futuro reabrisse o acesso
   por engano.

Escrita só acontece via `private.log_audit(...)` (`SECURITY DEFINER`), que
deriva `actor_user_id`/`actor_type` sempre de `auth.uid()`/
`private.is_platform_admin()` internamente — nunca de um parâmetro — para que
ninguém consiga forjar uma entrada em nome de outra pessoa. Triggers
automáticos (`audit_tenant_changes`, `audit_tenant_member_role_changes`,
`audit_profile_created`) chamam essa função para que a auditoria não dependa
de o código da aplicação "lembrar" de registrar (arquitetura §18.2). Override
financeiro manual (decisão §25.4) já tem a coluna `reason` e o `CHECK
audit_logs_payment_override_requires_reason` — a ação `PAYMENT_OVERRIDE`
exigirá motivo assim que a etapa de pagamentos existir.

## Tenant resolution

Nesta etapa não existe Middleware/Next.js resolvendo tenant ainda — isso é
`proxy.ts` nas Etapas 3/6 (arquitetura §3.2/§3.4). O que já existe é a
**fundação de banco** que qualquer estratégia de resolução vai consultar:
`tenant_members` é a única fonte de verdade sobre quem pertence a qual tenant;
nada (header, cookie, query param) é aceito como tenant válido sem bater
contra essa tabela via `private.is_tenant_member`.

## Uso do `service_role`

`service_role` tem `BYPASSRLS` de verdade — os testes de integração provam
isso deliberadamente (ver "TESTE 13" em
`tests/integration/rls-isolation.test.ts`: uma query sem filtro explícito de
tenant via `service_role` devolve linhas de todos os tenants). As únicas
proteções que **não** dependem de RLS e por isso seguram mesmo `service_role`
são os `REVOKE` explícitos (`platform_admins`, `audit_logs`) e os triggers
`BEFORE UPDATE`/`BEFORE DELETE`. Fora desses dois casos, todo código
server-side que usar `service_role` continuará precisando filtrar por
`tenant_id` explicitamente — a Etapa 2 não introduziu nenhum caminho de
aplicação usando `service_role` ainda (isso começa na Etapa 6/7, checkout e
pagamentos).

## Decisões de segurança desta etapa (resumo — detalhe completo no relatório final)

- CPF nunca em texto puro: `profiles.cpf_hash` (HMAC-SHA256 via
  `lib/security/hash-identifier.ts`), não uma coluna `cpf`.
- `tenant_members` manteve `status`/`invited_by` (não estavam na lista mínima
  do prompt desta etapa, mas já eram parte da arquitetura aprovada e
  `is_tenant_member` depende de `status = 'active'`).
- Só um OWNER (ou platform admin) pode conceder o papel OWNER; ninguém altera
  o próprio papel; `tenants.status` só muda por platform admin — cada uma
  dessas três regras tem RLS **e** um trigger dedicado (defesa em
  profundidade, não só a policy).
