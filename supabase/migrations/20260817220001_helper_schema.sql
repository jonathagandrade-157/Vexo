-- Etapa 2 — Fundação de banco: schema privado para funções auxiliares.
--
-- `private` nunca é exposto via API (não faz parte do schema `public` que o
-- PostgREST/Supabase publica), e nenhum papel de aplicação (anon,
-- authenticated, service_role) recebe privilégio de tabela dentro dele —
-- apenas EXECUTE em funções específicas, concedido migration a migration
-- conforme cada função é criada (arquitetura §6.1, §25.1).
create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;
