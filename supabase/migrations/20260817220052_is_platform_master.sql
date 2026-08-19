-- Etapa 14 — private.is_platform_master() (prompt §15/§26): distingue
-- MASTER de SUPPORT_AGENT dentro de platform_admins (Etapa 2), mesmo
-- padrão de private.is_platform_support() já existente — não é "um
-- segundo sistema de administrador" (prompt §15 explicitamente proíbe
-- isso), é o mesmo `platform_admins.role` já usado por
-- is_platform_support(), só que checando o outro valor. Necessário
-- porque a gestão de planos/recursos (escrita) é mais sensível que
-- suporte geral: só MASTER pode escrever preço/associação de recurso,
-- enquanto is_platform_admin() (MASTER OU SUPPORT_AGENT) continua
-- suficiente para o simples acesso de leitura ao /master.
create function private.is_platform_master()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid() and pa.role = 'MASTER'
  );
$$;

comment on function private.is_platform_master() is
  'True só se o usuário autenticado é MASTER (não SUPPORT_AGENT) — usado para gates de escrita em configuração comercial (planos/recursos/preços), mais restrito que is_platform_admin().';

grant execute on function private.is_platform_master() to authenticated, service_role;
