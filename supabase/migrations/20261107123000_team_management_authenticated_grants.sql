-- Gestão de equipe pelo cliente de sessão: privilégios mínimos.
--
-- changeTeamMemberRoleAction e removeTeamMemberAction (features/team/
-- actions.ts) usam o cliente de SESSÃO, com as policies "team managers can
-- update other members roles" / "can remove other members" e os triggers
-- de auto-promoção, concessão de OWNER e último OWNER como autoridade.
-- Em produção (inventário somente leitura de 2026-11-07) authenticated só
-- tem SELECT em tenant_members: as policies nunca chegam a ser avaliadas e
-- trocar função ou remover membro falha — reproduzido no CI com Supabase
-- local real depois que o convite passou a funcionar.
--
-- UPDATE é concedido apenas na coluna role_id: a policy de UPDATE não
-- restringe colunas, então um grant de tabela inteira deixaria a API
-- pública alterar status/invited_by (mass assignment). tenant_id e user_id
-- já são imutáveis por trigger. updated_at é ajustado pelo trigger, que não
-- exige privilégio de coluna. Não altera dados, policies nem funções.
-- Rollback:
--   revoke update (role_id), delete on public.tenant_members from authenticated;

revoke update on table public.tenant_members from authenticated;
grant update (role_id) on table public.tenant_members to authenticated;
grant delete on table public.tenant_members to authenticated;
