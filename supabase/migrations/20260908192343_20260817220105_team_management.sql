-- D18.3 (Fase 1) — Equipe/Funcionários. Fecha o gap de UI identificado na
-- auditoria D18.0 (§C.1: "team.manage existe desde a Etapa 2, nenhuma
-- Server Action o usa"). Auditoria prévia obrigatória (ver relatório
-- D18.3) confirmou: nenhum trigger cobre INSERT/DELETE em tenant_members
-- (só UPDATE de role_id, migration 20260817220010); nenhuma proteção
-- contra remover/rebaixar o último OWNER de um tenant; `profiles` não tem
-- nenhuma policy de SELECT que permita a um colega de equipe ver nome/
-- e-mail de outro membro (só a própria linha + platform_admin).
--
-- Todas as mudanças abaixo são aditivas — não altera D18.1 (audit_tenant_
-- changes/audit_tenant_domain_changes), D18.2 (policies de tenant_domains),
-- private.log_audit(), o RBAC (roles/permissions/role_permissions), nem os
-- 3 triggers de tenant_members já existentes (prevent_tenant_member_user_id_
-- change, prevent_self_role_change, prevent_unauthorized_owner_grant).

-- ============================================================
-- 1) Auditoria de INSERT/DELETE/status em tenant_members
-- ============================================================
--
-- Estende private.audit_tenant_member_role_changes() (Etapa 2, migration
-- 20260817220010) — mesma função, mesmo princípio de "extender via CREATE
-- OR REPLACE" já usado em D18.1 para private.audit_tenant_changes(). Como
-- a função original só cobria UPDATE, o TRIGGER precisa ser recriado para
-- também disparar em INSERT/DELETE (CREATE OR REPLACE FUNCTION sozinho não
-- muda em quais eventos o trigger dispara) — por isso o DROP/CREATE TRIGGER
-- abaixo, não uma alteração de D18.1/D18.2 (aquela migration nunca tocou
-- este trigger).
create or replace function private.audit_tenant_member_role_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.tenant_id, 'TEAM_MEMBER_INVITED', 'tenant_member', new.id::text,
      null,
      jsonb_build_object('role_id', new.role_id, 'status', new.status, 'target_user_id', new.user_id)
    );
  elsif tg_op = 'DELETE' then
    perform private.log_audit(
      old.tenant_id, 'TEAM_MEMBER_REMOVED', 'tenant_member', old.id::text,
      jsonb_build_object('role_id', old.role_id, 'status', old.status, 'target_user_id', old.user_id),
      null
    );
  elsif tg_op = 'UPDATE' and old.role_id is distinct from new.role_id then
    perform private.log_audit(
      new.tenant_id, 'USER_ROLE_CHANGED', 'tenant_member', new.id::text,
      jsonb_build_object('role_id', old.role_id),
      jsonb_build_object('role_id', new.role_id),
      null,
      jsonb_build_object('target_user_id', new.user_id)
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform private.log_audit(
      new.tenant_id, 'TEAM_MEMBER_STATUS_CHANGED', 'tenant_member', new.id::text,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status, 'target_user_id', new.user_id)
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger audit_tenant_member_role_changes on public.tenant_members;

create trigger audit_tenant_member_role_changes
  after insert or update or delete on public.tenant_members
  for each row
  execute function private.audit_tenant_member_role_changes();

-- ============================================================
-- 2) Proteção contra remover ou rebaixar o último OWNER de um tenant
-- ============================================================
--
-- Gap real encontrado na auditoria: os 3 triggers existentes protegem
-- "quem pode conceder OWNER" e "ninguém muda o próprio papel", mas nada
-- impede remover (DELETE) ou rebaixar (UPDATE role_id para != OWNER) o
-- ÚLTIMO OWNER ativo de um tenant, o que deixaria a loja sem governança —
-- exatamente o cenário que o ticket D18.3 pede para fechar. Mesmo padrão
-- de defesa em profundidade dos triggers de 20260817220013: incondicional,
-- independente de RLS/permissão, cobre inclusive uma policy futura editada
-- incorretamente.
create function private.prevent_removing_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_role_key text;
  v_new_role_key text;
  v_losing_owner boolean;
  v_other_active_owners int;
begin
  select key into v_old_role_key from public.roles where id = old.role_id;

  if v_old_role_key is distinct from 'OWNER' or old.status <> 'active' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    v_losing_owner := true;
  else
    select key into v_new_role_key from public.roles where id = new.role_id;
    v_losing_owner := (v_new_role_key is distinct from 'OWNER') or (new.status is distinct from 'active');
  end if;

  if not v_losing_owner then
    return coalesce(new, old);
  end if;

  select count(*) into v_other_active_owners
  from public.tenant_members tm
  join public.roles r on r.id = tm.role_id
  where tm.tenant_id = old.tenant_id
    and tm.status = 'active'
    and r.key = 'OWNER'
    and tm.id <> old.id;

  if v_other_active_owners = 0 then
    raise exception
      'cannot remove or demote the last active OWNER of a tenant — assign another OWNER first'
      using errcode = '23514'; -- check_violation
  end if;

  return coalesce(new, old);
end;
$$;

comment on function private.prevent_removing_last_owner() is
  'D18.3 — impede DELETE ou UPDATE (role/status) que deixaria um tenant sem nenhum OWNER ativo. Independente de RLS/permissão, mesmo padrão de defesa em profundidade de prevent_unauthorized_owner_grant (20260817220013).';

create trigger prevent_removing_last_owner
  before update or delete on public.tenant_members
  for each row
  execute function private.prevent_removing_last_owner();

-- ============================================================
-- 3) accept_tenant_invite() — RPC que o convidado chama (indiretamente,
--    via features/auth/actions.ts::updatePasswordAction) depois de definir
--    a senha pelo link de convite do Supabase Auth, para transicionar sua
--    própria linha 'invited' -> 'active'.
-- ============================================================
--
-- Mesmo padrão de segurança de public.create_tenant() (20260817220011):
-- SECURITY DEFINER porque tenant_members não tem policy de UPDATE para
-- authenticated cobrindo a própria linha (a policy existente de UPDATE
-- exige team.manage E user_id <> auth.uid() — nunca a própria linha, de
-- propósito, ver 20260817220013), e o ator é sempre auth.uid() interno,
-- nunca um parâmetro — impossível aceitar convite "em nome" de outro
-- usuário. Só transiciona linhas já 'invited' do PRÓPRIO usuário — nunca
-- cria, nunca muda role_id/tenant_id, nunca aceita um id de linha como
-- parâmetro.
create function public.accept_tenant_invite()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'accept_tenant_invite: authentication required'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  update public.tenant_members
  set status = 'active'
  where user_id = v_uid and status = 'invited';
end;
$$;

comment on function public.accept_tenant_invite() is
  'D18.3 — transiciona toda linha tenant_members(user_id=auth.uid(), status=invited) para active. Chamada por updatePasswordAction logo após o convidado definir a senha pelo link de convite do Supabase Auth (nenhuma página nova). Nunca recebe usuário/tenant como parâmetro.';

revoke execute on function public.accept_tenant_invite() from public, anon, service_role;
grant execute on function public.accept_tenant_invite() to authenticated;

-- ============================================================
-- 4) RLS de profiles — visibilidade de colegas de equipe
-- ============================================================
--
-- Gap real encontrado na auditoria: profiles (20260817220002) só permite
-- `id = auth.uid()` (+ platform_admin, 20260817220009) — nenhuma policy
-- permite a um OWNER/ADMIN ver nome/e-mail de OUTRO membro do próprio
-- tenant, bloqueando a funcionalidade #2 do ticket ("visualizar: nome;
-- e-mail"). Policy nova, aditiva, escopada por team.view (não apenas
-- membership — só quem já tem a permissão de ver a equipe pode ver
-- perfis de colegas): perfil de um usuário X é visível a quem tem
-- team.view em algum tenant onde X é membro (active ou invited).
-- has_permission() resolve auth.uid() internamente — nunca confia em
-- nenhum id vindo de fora desta policy.
create policy "tenant staff with team.view can select co-members profiles"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_members tm
      where tm.user_id = profiles.id
        and tm.status in ('active', 'invited')
        and private.has_permission(tm.tenant_id, 'team.view')
    )
  );
