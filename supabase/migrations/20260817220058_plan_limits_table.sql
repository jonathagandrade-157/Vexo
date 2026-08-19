-- Etapa 14 (ajuste arquitetural) — plan_limits: feature e limite são
-- conceitos diferentes ("pode usar relatórios" vs. "pode cadastrar até
-- 500 produtos") — tabela própria, não reaproveita plan_features. Mesma
-- forma chave/valor de `features`/`plan_features` (extensível sem
-- migration nova: cadastrar um limite é um INSERT). `limit_value = -1`
-- é o sentinel documentado para "ilimitado" — nunca NULL para essa
-- semântica (NULL aqui significa "nenhum limite configurado para esse
-- plano/chave ainda", diferente de "ilimitado").
--
-- Acesso "somente pelo MASTER" (instrução explícita) — diferente de
-- plans/features/plan_features, que o lojista/anon podem LER (catálogo
-- comercial). Limite é considerado dado operacional interno da VEXO
-- nesta etapa, não exibido a ninguém fora do MASTER ainda (a consulta
-- pelo próprio tenant, quando a UI de limites do lojista existir, entra
-- por uma policy adicional numa etapa futura — não inventada agora).
create table public.plan_limits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  limit_key text not null check (limit_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  limit_value integer not null check (limit_value >= -1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_limits_plan_key_unique unique (plan_id, limit_key)
);

comment on table public.plan_limits is
  'Limites numéricos por plano (ex.: products_limit=100) — distinto de plan_features (capacidade booleana). limit_value = -1 significa ilimitado. Acesso exclusivo do MASTER.';

create index plan_limits_plan_id_idx on public.plan_limits (plan_id);

alter table public.plan_limits enable row level security;
alter table public.plan_limits force row level security;

create trigger set_updated_at before update on public.plan_limits
  for each row execute function private.set_updated_at();

create policy "only master can select plan_limits"
  on public.plan_limits for select
  to authenticated
  using (private.is_platform_master());

create policy "only master can insert plan_limits"
  on public.plan_limits for insert
  to authenticated
  with check (private.is_platform_master());

create policy "only master can update plan_limits"
  on public.plan_limits for update
  to authenticated
  using (private.is_platform_master())
  with check (private.is_platform_master());

create policy "only master can delete plan_limits"
  on public.plan_limits for delete
  to authenticated
  using (private.is_platform_master());
