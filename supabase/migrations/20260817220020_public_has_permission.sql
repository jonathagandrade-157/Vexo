-- Etapa 5 — public.has_permission() (arquitetura §6.1; painel do lojista).
--
-- Wrapper fino sobre private.has_permission() (Etapa 2) — NÃO reimplementa
-- a checagem: só delega. Existe porque Server Actions do Next.js (fora do
-- Postgres) não conseguem chamar uma função do schema `private` via RPC
-- do PostgREST (só funções em `public` são expostas como RPC), mas o
-- painel precisa checar permissão explicitamente no servidor antes de
-- executar uma mutação (arquitetura §12/§13 do prompt da Etapa 5 —
-- "verificar permission" é uma responsabilidade própria da Server Action,
-- não só algo que a RLS acaba resolvendo silenciosamente).
--
-- language sql (não plpgsql) + security invoker (não definer): não há
-- nada a proteger aqui além do que private.has_permission() já protege
-- sozinho (ela é SECURITY DEFINER e resolve auth.uid() internamente) —
-- adicionar DEFINER nesta camada só aumentaria a superfície sem motivo
-- (arquitetura §14: minimizar uso de DEFINER).
create function public.has_permission(p_tenant_id uuid, p_permission_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_permission(p_tenant_id, p_permission_key);
$$;

comment on function public.has_permission(uuid, text) is
  'Wrapper RPC-chamável de private.has_permission() (Etapa 2) — não duplica a lógica de autorização, só expõe a mesma checagem para Server Actions verificarem permission explicitamente antes de mutar (arquitetura §12 Etapa 5).';

revoke execute on function public.has_permission(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.has_permission(uuid, text) to authenticated, service_role;
