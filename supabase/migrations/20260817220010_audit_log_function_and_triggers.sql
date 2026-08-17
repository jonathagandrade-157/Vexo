-- Etapa 2 — private.log_audit() e triggers automáticos de auditoria
-- (arquitetura §18.2, §25.1, §25.3).
--
-- Por que SECURITY DEFINER: nenhum papel de aplicação (anon, authenticated)
-- recebe INSERT direto em audit_logs (ver REVOKE em 0015) — a única forma
-- de gravar uma entrada é através desta função, que valida e normaliza os
-- dados antes de inserir. Sem DEFINER, um OWNER comum tentando registrar a
-- própria ação (via um trigger disparado pela própria alteração que fez)
-- esbarraria em falta de privilégio de INSERT na tabela.
--
-- Por que o actor NUNCA é um parâmetro: se a função aceitasse
-- `actor_user_id`/`actor_type` como argumento vindo de quem chama, um
-- usuário malicioso (ou um bug de aplicação) poderia forjar entradas
-- atribuindo uma ação a outra pessoa. actor_user_id/actor_type são sempre
-- derivados de auth.uid()/private.is_platform_admin() dentro da própria
-- função, nunca aceitos de fora.
create function private.log_audit(
  p_tenant_id uuid,
  p_action text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_actor_type text;
  v_id uuid;
begin
  v_actor_user_id := auth.uid();

  if private.is_platform_admin() then
    v_actor_type := 'master';
  elsif v_actor_user_id is not null then
    v_actor_type := 'user';
  else
    v_actor_type := 'system';
  end if;

  -- Impede que um chamador arbitrário registre eventos "em nome" de um
  -- tenant ao qual não pertence, poluindo/forjando a trilha de auditoria
  -- de outra loja. auth.role() = 'service_role' cobre o código
  -- server-side confiável (que já passou pela própria checagem de
  -- autorização da aplicação antes de chegar aqui — arquitetura §17/§18.2).
  --
  -- auth.role()/auth.uid() continuam refletindo a sessão ORIGINAL mesmo
  -- dentro de uma cadeia de funções SECURITY DEFINER (são GUCs de sessão,
  -- não mudam com o "current_user" efetivo) — os triggers desta migration,
  -- embora SECURITY DEFINER, não viram automaticamente 'service_role' aos
  -- olhos desta guarda; eles só passam porque o ATOR continua sendo membro
  -- do tenant (ou, no caso de TENANT_CREATED, é quem acabou de criá-lo —
  -- ver a exceção abaixo).
  --
  -- Exceção necessária para TENANT_CREATED: o trigger audit_tenant_changes
  -- dispara AFTER INSERT em tenants, ou seja, ANTES de
  -- public.create_tenant() (0011) inserir a linha correspondente em
  -- tenant_members — nesse instante exato, quem acabou de criar o tenant
  -- ainda não é "membro" dele segundo private.is_tenant_member(). Sem esta
  -- exceção, create_tenant() falharia sempre (bug encontrado pelos testes
  -- de integração — ver relatório da Etapa 2). tenants.created_by só pode
  -- ter sido definido pelo próprio create_tenant() a partir de auth.uid()
  -- no momento do INSERT, então não é um valor que o chamador possa forjar
  -- para esta checagem.
  if p_tenant_id is not null
     and auth.role() is distinct from 'service_role'
     and not (
       private.is_platform_admin()
       or private.is_tenant_member(p_tenant_id)
       or exists (
         select 1 from public.tenants t
         where t.id = p_tenant_id and t.created_by = auth.uid()
       )
     )
  then
    raise exception
      'log_audit: caller is not authorized to log an event for tenant %',
      p_tenant_id
      using errcode = '42501'; -- insufficient_privilege
  end if;

  insert into public.audit_logs (
    tenant_id, actor_user_id, actor_type, action,
    resource_type, resource_id, before, after, reason, metadata
  ) values (
    p_tenant_id, v_actor_user_id, v_actor_type, p_action,
    p_resource_type, p_resource_id, p_before, p_after, p_reason, p_metadata
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.log_audit(uuid, text, text, text, jsonb, jsonb, text, jsonb) is
  'Único caminho de escrita em audit_logs. actor_user_id/actor_type são sempre derivados internamente (auth.uid()/is_platform_admin()), nunca aceitos como parâmetro, para impedir forjar entradas em nome de outra pessoa.';

-- EXECUTE só para service_role (código server-side, ex.: Route Handlers do
-- painel Master em etapas futuras). "authenticated" não recebe EXECUTE
-- diretamente: as ações de um usuário comum são auditadas pelos triggers
-- abaixo, que são SECURITY DEFINER e portanto não precisam que o próprio
-- usuário tenha EXECUTE nesta função.
revoke all on function private.log_audit(uuid, text, text, text, jsonb, jsonb, text, jsonb) from public;
grant execute on function private.log_audit(uuid, text, text, text, jsonb, jsonb, text, jsonb) to service_role;

-- Triggers automáticos: garantem que a ação é registrada mesmo que o
-- código da aplicação "esqueça" de chamar log_audit explicitamente
-- (arquitetura §18.2 — "estruturalmente acoplado à mutação, não uma etapa
-- opcional de código"). SECURITY DEFINER pelo mesmo motivo de log_audit:
-- permitem que a ação de um OWNER/ADMIN comum (que não tem EXECUTE direto
-- em log_audit) ainda assim gere o registro.
create function private.audit_tenant_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(
      new.id, 'TENANT_CREATED', 'tenant', new.id::text,
      null, jsonb_build_object('name', new.name, 'slug', new.slug, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform private.log_audit(
      new.id,
      case new.status when 'suspended' then 'TENANT_SUSPENDED' else 'TENANT_STATUS_CHANGED' end,
      'tenant', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger audit_tenant_changes
  after insert or update on public.tenants
  for each row
  execute function private.audit_tenant_changes();

create function private.audit_tenant_member_role_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role_id is distinct from new.role_id then
    perform private.log_audit(
      new.tenant_id, 'USER_ROLE_CHANGED', 'tenant_member', new.id::text,
      jsonb_build_object('role_id', old.role_id),
      jsonb_build_object('role_id', new.role_id),
      null,
      jsonb_build_object('target_user_id', new.user_id)
    );
  end if;
  return new;
end;
$$;

create trigger audit_tenant_member_role_changes
  after update on public.tenant_members
  for each row
  execute function private.audit_tenant_member_role_changes();

create function private.audit_profile_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_audit(null, 'USER_CREATED', 'profile', new.id::text);
  return new;
end;
$$;

create trigger audit_profile_created
  after insert on public.profiles
  for each row
  execute function private.audit_profile_created();

-- Não implementado nesta etapa (registrado como decisão pendente no
-- relatório final): LOGIN_SECURITY_EVENT exigiria um Auth Hook do
-- Supabase Auth escrevendo em audit_logs a cada login/falha — isso é
-- infraestrutura de integração, não "fundação", e fica para quando a
-- tela de segurança/atividade do painel precisar dela.
