-- Convite de equipe: privilégios mínimos do servidor administrativo.
--
-- inviteTeamMemberAction (features/team/actions.ts) usa service_role para
-- resolver a função convidada em `roles` e gravar a membership `invited`
-- em `tenant_members` (não há policy de INSERT para authenticated, de
-- propósito). Em produção (inventário somente leitura de 2026-11-07)
-- service_role não tem SELECT nem INSERT nessas tabelas: o convite falha
-- com "Função inválida." — reproduzido no CI com Supabase local real.
--
-- O trigger BEFORE INSERT prevent_unauthorized_owner_insert é SECURITY
-- INVOKER e lê `roles` e, para OWNER, `tenant_members`; por isso SELECT
-- nas duas. Nenhum UPDATE/DELETE: troca de função e remoção continuam no
-- cliente de sessão, sob RLS e triggers. Não altera dados, RLS ou funções.
-- Rollback:
--   revoke insert, select on public.tenant_members from service_role;
--   revoke select on public.roles from service_role;

grant select on table public.roles to service_role;
grant select, insert on table public.tenant_members to service_role;
