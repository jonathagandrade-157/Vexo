-- APENAS PARA TESTES LOCAIS. NUNCA aplicar em um projeto Supabase real —
-- lá o schema `auth` (auth.users, auth.uid(), auth.role(), os papéis
-- anon/authenticated/service_role, e os GRANTs padrão abaixo) já existe,
-- provisionado pelo próprio Supabase. Este arquivo recria só o suficiente
-- desse contrato para testar as migrations de supabase/migrations/ contra
-- um Postgres comum — este sandbox não tem acesso de rede para baixar as
-- imagens Docker do `supabase start` (ver risco registrado no relatório
-- da Etapa 2). Aplicar ANTES das migrations reais.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

-- auth.uid()/auth.role() leem a mesma GUC que o PostgREST define a cada
-- request em produção (`request.jwt.claims`) — o mesmo contrato que as
-- funções em private.* (arquitetura §6.1) dependem.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- bypassrls espelha o papel real do Supabase — é exatamente essa
    -- propriedade que faz os testes de audit_logs/platform_admins
    -- valerem a pena (RLS sozinha não conteria este papel).
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

-- Em produção, o Supabase concede estes privilégios de tabela por padrão
-- para TODA tabela nova em `public`, deixando a RLS como a restrição real
-- linha-a-linha (é por isso que as migrations desta etapa não fazem GRANT
-- explícito nas tabelas de negócio, só REVOKE nos dois casos em que a
-- escrita deve ficar bloqueada mesmo para service_role: platform_admins e
-- audit_logs). ALTER DEFAULT PRIVILEGES precisa rodar ANTES de as tabelas
-- existirem para valer sobre elas.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant usage, select, update on sequences to authenticated, anon, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated, anon, service_role;

-- Réplica simplificada (Etapa 8) do schema `storage` do Supabase real —
-- só o suficiente para testar as policies de storage.objects da
-- migration 20260817220028 contra Postgres puro: NÃO modela metadata
-- completo (mimetype/size no bucket, versionamento, etc.), só as colunas
-- de que as próprias policies e `storage.foldername()` dependem.
-- `storage.foldername()` aqui é a mesma lógica da função real do
-- Supabase (todos os segmentos do path exceto o nome do arquivo).
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1];
$$;

alter table storage.objects enable row level security;
alter table storage.objects force row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
