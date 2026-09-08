-- D18.3.1 — corrige os 3 achados CRÍTICO/MÉDIO da revisão de segurança de
-- D18.3 (relatório "D18.3 — REVISÃO FINAL DE SEGURANÇA"):
--   1-3 (CRÍTICO) — inviteTeamMemberAction conseguia inserir um novo membro
--       diretamente com role OWNER (INSERT via service_role, nenhum dos 3
--       triggers de proteção de OWNER cobre INSERT, todos são BEFORE UPDATE).
--   4 (MÉDIO) — prevent_removing_last_owner tinha uma condição de corrida:
--       duas transações concorrentes removendo/rebaixando os 2 únicos OWNERs
--       de um tenant podiam ambas passar na contagem antes de qualquer uma
--       commitar.
--   5 (MÉDIO) — a policy de profiles do D18.3 libera a LINHA inteira
--       (inclusive phone/cpf_hash) a qualquer colega com team.view, embora a
--       UI só precise de id/full_name/email.
--
-- Todas as mudanças abaixo são aditivas — não altera D18.1, D18.2,
-- private.log_audit(), o RBAC, nem os triggers/policies do D18.3 que já
-- estavam corretos (RLS de tenant_members, accept_tenant_invite(),
-- audit_tenant_member_role_changes()). create_tenant() (Etapa 2) não é
-- tocado.

-- ============================================================
-- 1) BEFORE INSERT em tenant_members — bloqueia OWNER exceto na membership
--    fundadora de um tenant novo
-- ============================================================
--
-- Distinção entre "OWNER inicial legítimo" e "convite malicioso/indevido de
-- OWNER" sem depender de nenhuma flag de sessão nem tocar em
-- create_tenant(): um tenant só tem ZERO linhas em tenant_members no
-- instante exato entre o INSERT em `tenants` e o INSERT em `tenant_members`
-- dentro de create_tenant() (mesma transação, tenant_id recém-gerado) — não
-- existe NENHUM outro caminho no código (RLS de `tenants` não tem policy de
-- INSERT para authenticated, migration 20260817220012) que produza um
-- tenant_id "órfão" (existente em `tenants`, sem nenhum membro ainda) para
-- inviteTeamMemberAction/qualquer outro código explorar — `resolveTenantAndPermission`
-- em toda Server Action de convite/gestão só resolve tenants que o ator já
-- é membro ATIVO, ou seja, tenant_id sempre chega aqui com >= 1 membro
-- existente. Por isso "contagem de membros existentes = 0" é um sinal
-- seguro e auto-contido, sem exigir nenhuma coordenação com create_tenant().
create function private.prevent_unauthorized_owner_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new_role_key text;
  v_existing_members int;
begin
  select key into v_new_role_key from public.roles where id = new.role_id;
  if v_new_role_key is distinct from 'OWNER' then
    return new;
  end if;

  select count(*) into v_existing_members
  from public.tenant_members
  where tenant_id = new.tenant_id;

  if v_existing_members > 0 then
    raise exception
      'a new membership can only be granted the OWNER role as the founding member of a brand-new tenant — invite this person with a non-OWNER role, then have an existing OWNER promote them'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  return new;
end;
$$;

comment on function private.prevent_unauthorized_owner_insert() is
  'D18.3.1 — bloqueia INSERT de tenant_members com role OWNER exceto quando é a membership fundadora (tenant ainda sem nenhum membro) — fecha o caminho de INSERT que os triggers de UPDATE (prevent_unauthorized_owner_grant, 20260817220013) nunca cobriam. create_tenant() continua funcionando sem alteração: o INSERT que ele faz é sempre o primeiro do tenant recém-criado.';

create trigger prevent_unauthorized_owner_insert
  before insert on public.tenant_members
  for each row
  execute function private.prevent_unauthorized_owner_insert();

-- ============================================================
-- 2) prevent_removing_last_owner — fecha a condição de corrida com um
--    advisory lock transacional escopado ao tenant
-- ============================================================
--
-- pg_advisory_xact_lock: liberado automaticamente no fim da transação
-- (commit OU rollback) — nunca precisa de unlock manual, nunca vaza para
-- fora da transação corrente. Reentrante dentro da MESMA transação (uma
-- única instrução afetando 2 linhas OWNER do mesmo tenant não se
-- autobloqueia). Escopado ao tenant via dois argumentos int4 — nunca um
-- lock global: hashtext('tenant_owner_guard') é só um namespace fixo para
-- não colidir com um advisory lock de outro subsistema que venha a existir
-- no futuro; hashtext(tenant_id::text) é a chave específica deste tenant.
--
-- Só adquirido quando a linha É de fato um OWNER ativo perdendo o papel
-- (depois do mesmo curto-circuito já existente) — nenhum custo de lock para
-- o caminho comum (atualizar/remover um não-OWNER).
--
-- Efeito: duas transações concorrentes removendo/rebaixando os 2 únicos
-- OWNERs ativos do mesmo tenant agora serializam neste lock — a segunda só
-- reavalia a contagem depois que a primeira já commitou (ou fez rollback),
-- então sempre enxerga o estado real e definitivo, nunca um instantâneo
-- desatualizado de uma transação concorrente ainda não commitada.
create or replace function private.prevent_removing_last_owner()
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

  perform pg_advisory_xact_lock(hashtext('tenant_owner_guard'), hashtext(old.tenant_id::text));

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

-- ============================================================
-- 3) team_member_profiles — projeção somente-leitura e somente-colunas de
--    profiles, sem tocar na RLS de profiles em si
-- ============================================================
--
-- A policy de profiles do D18.3 (20260817220105, "tenant staff with
-- team.view can select co-members profiles") continua exatamente como
-- estava — permanece a única autoridade sobre QUAIS LINHAS um colega pode
-- ver, corretamente escopada por tenant.view + membership compartilhada
-- (revisada e confirmada correta no relatório de segurança). O problema
-- reportado é de COLUNA, não de linha: a policy libera a linha inteira
-- (phone/cpf_hash inclusive), mas a aplicação só precisa de id/full_name/
-- email. Resolvido com uma VIEW estreita — não duplica dado (sempre lê
-- profiles ao vivo), não é JSONB, não é tabela nova, não é um sistema de
-- autorização paralelo: seguridade continua vindo inteiramente da RLS de
-- profiles, só as colunas expostas mudam.
--
-- security_invoker = true (Postgres 15+, suportado tanto no Postgres 17 de
-- produção quanto no 16 usado localmente para validar esta migration) é
-- OBRIGATÓRIO aqui: sem isso, a view rodaria com os privilégios do dono
-- (superuser da migration), ignorando a RLS de profiles por completo e
-- mostrando TODAS as linhas a qualquer authenticated — o oposto do
-- objetivo. Com security_invoker=true, a RLS de profiles é reavaliada como
-- o usuário que está de fato consultando a view.
--
-- Risco residual reconhecido e documentado (não corrigido nesta etapa,
-- conforme instrução explícita do ticket D18.3.1 — "se a única solução
-- limpa exigir alteração estrutural maior, não implementar agora"): esta
-- view garante que o CÓDIGO da aplicação nunca busca phone/cpf_hash para a
-- tela de equipe. Ela NÃO revoga o acesso à tabela `profiles` em si — um
-- colega com team.view tecnicamente ainda poderia consultar
-- phone/cpf_hash diretamente via PostgREST (`/profiles?select=phone`), já
-- que a policy de linha continua permitindo a linha inteira. Fechar isso
-- por completo exigiria reestruturar o acesso a `profiles` para nunca mais
-- conceder SELECT direto a `authenticated` (só através de views), uma
-- mudança bem maior, fora do escopo desta correção pontual — registrado
-- como follow-up explícito, não implementado.
create view public.team_member_profiles
with (security_invoker = true)
as
select id, full_name, email
from public.profiles;

comment on view public.team_member_profiles is
  'D18.3.1 — projeção somente-leitura de public.profiles, limitada a id/full_name/email (nunca phone/cpf_hash). security_invoker=true: a RLS de profiles (20260817220002/20260817220009/20260817220105) continua sendo a única autoridade sobre quais LINHAS aparecem — esta view só estreita as COLUNAS. Risco residual documentado: profiles em si ainda concede a linha inteira via PostgREST direto, não revogado nesta etapa (ver comentário da migration).';

grant select on public.team_member_profiles to authenticated;
