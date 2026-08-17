-- Etapa 2 — profiles (arquitetura §5.1, §7).
--
-- 1:1 com auth.users. `id` é PK e FK para auth.users(id) — nunca gerado
-- independentemente, nunca alterável (ver policy de UPDATE mais abaixo:
-- `with check (id = auth.uid())` torna qualquer tentativa de trocar `id`
-- equivalente a "criar" uma linha para outro usuário, o que a mesma policy
-- já rejeita).
--
-- CONFLITO IDENTIFICADO COM O PROMPT DA ETAPA 2 (registrado, não
-- sobrescrito silenciosamente — ver relatório final):
-- O prompt pede uma coluna `cpf`. A arquitetura aprovada (§13, §18.2,
-- §25.1) proíbe armazenar CPF/CNPJ em texto puro em qualquer lugar do
-- banco. Resolução escolhida (mais segura e ainda compatível com o pedido
-- de "tratamento adequado de unicidade"): a coluna é `cpf_hash`
-- (HMAC-SHA256, mesmo padrão de `document_hash` do §13), nunca o CPF em
-- texto puro. O helper que calcula esse hash (`lib/security/hash-identifier.ts`)
-- já existe no código da aplicação; nenhum fluxo ainda escreve nesta coluna
-- (isso é conteúdo de uma etapa futura — trial/onboarding).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  -- Cópia não autoritativa do e-mail de auth.users, mantida em sincronia
  -- pelo trigger abaixo. Nunca usada para decisão de autorização — apenas
  -- exibição/contato (arquitetura §4 do prompt desta etapa: "email não deve
  -- ser tratado como fonte definitiva de autorização").
  email text,
  cpf_hash text unique,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Perfil da plataforma, 1:1 com auth.users. id nunca é alterável — ver RLS.';
comment on column public.profiles.cpf_hash is
  'HMAC-SHA256(CPF normalizado, TRIAL_HASH_SECRET). Nunca o CPF em texto puro (arquitetura §13/§25.1).';

-- Trigger genérico de updated_at, reutilizado por outras tabelas mutáveis
-- desta e de etapas futuras (tenants, tenant_members, ...).
create function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on public.profiles
  for each row
  execute function private.set_updated_at();

-- Cria automaticamente o profile quando um novo auth.users é criado, e
-- mantém profiles.email em sincronia quando o e-mail muda no Auth.
-- SECURITY DEFINER é necessário porque o trigger dispara no contexto do
-- Supabase Auth (não há um `authenticated`/`anon` de app fazendo a
-- inserção) — sem DEFINER, a inserção em public.profiles esbarraria em
-- RLS/GRANT sem nenhum papel de aplicação autorizado a executá-la.
-- search_path vazio + nomes totalmente qualificados evitam sequestro de
-- search_path (arquitetura §14).
create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_auth_user();

create function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  execute function private.sync_profile_email();

-- RLS: cada usuário só enxerga/edita o próprio profile. platform_admins
-- (MASTER) também pode enxergar todos — necessário para o painel de
-- suporte/gestão de contas em etapas futuras; a checagem é feita pela
-- função private.is_platform_admin(), criada em migration posterior
-- (0009_auth_helper_functions), então a policy de MASTER é adicionada lá
-- para evitar referência a uma função que ainda não existe neste ponto.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy "users can select their own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Sem policy de INSERT/DELETE para authenticated/anon: a única linha
-- criada por usuário é a do trigger acima (SECURITY DEFINER, contorna RLS
-- via o papel dono da função); a aplicação nunca insere/apaga profiles
-- diretamente.
