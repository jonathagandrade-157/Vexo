-- Etapa 12 — frete/entrega (arquitetura §16: shipping_methods já estava
-- desenhada ali, adaptada aqui com um `type` novo — 'flat_rate' — porque
-- não há credenciais reais de Correios/Melhor Envio disponíveis nesta
-- etapa (prompt §6/§27: "não inventar integração real"). Nenhuma
-- estrutura de frete existia (confirmado por busca antes de criar).
--
-- Duas tabelas: `shipping_settings` (1 linha por tenant — liga/desliga
-- entrega, CEP de origem) e `shipping_methods` (1 linha por modalidade
-- — "configura", 1:N, exatamente como o ERD da arquitetura já previa).
create table public.shipping_settings (
  tenant_id uuid primary key references public.tenants (id),
  enabled boolean not null default false,
  origin_zip text check (origin_zip is null or origin_zip ~ '^[0-9]{8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shipping_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  -- Só 'flat_rate' nesta etapa (cresce por migration quando um
  -- provedor real de Correios/Melhor Envio for implementado, mesmo
  -- padrão de products.status/orders.status) — preço fixo configurado
  -- pelo lojista, não varia por CEP/peso.
  type text not null default 'flat_rate' check (type in ('flat_rate')),
  name text not null check (char_length(name) between 1 and 80),
  price numeric(10, 2) not null check (price >= 0),
  estimated_days integer check (estimated_days is null or estimated_days > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_methods_tenant_name_unique unique (tenant_id, name)
);

create index shipping_methods_tenant_id_idx on public.shipping_methods (tenant_id);

alter table public.shipping_settings enable row level security;
alter table public.shipping_settings force row level security;
alter table public.shipping_methods enable row level security;
alter table public.shipping_methods force row level security;

create trigger set_updated_at before update on public.shipping_settings
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.shipping_methods
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_id_change before update on public.shipping_methods
  for each row execute function private.prevent_tenant_id_change();

-- Leitura: qualquer membro do tenant vê (mesmo padrão de
-- /painel/configuracoes, que mostra os campos a todo staff e só exige
-- settings.update para editar). Escrita: settings.update (permissão já
-- existente desde a Etapa 2 — não criada agora, prompt §15).
create policy "tenant members can view shipping settings"
  on public.shipping_settings for select
  to authenticated
  using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

create policy "tenant staff with settings.update can upsert shipping settings"
  on public.shipping_settings for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'settings.update'));

create policy "tenant staff with settings.update can update shipping settings"
  on public.shipping_settings for update
  to authenticated
  using (private.has_permission(tenant_id, 'settings.update'))
  with check (private.has_permission(tenant_id, 'settings.update'));

create policy "tenant members can view shipping methods"
  on public.shipping_methods for select
  to authenticated
  using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

create policy "tenant staff with settings.update can insert shipping methods"
  on public.shipping_methods for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'settings.update'));

create policy "tenant staff with settings.update can update shipping methods"
  on public.shipping_methods for update
  to authenticated
  using (private.has_permission(tenant_id, 'settings.update'))
  with check (private.has_permission(tenant_id, 'settings.update'));

create policy "tenant staff with settings.update can delete shipping methods"
  on public.shipping_methods for delete
  to authenticated
  using (private.has_permission(tenant_id, 'settings.update'));

-- Leitura pública (storefront/checkout, anon) — só para lojas com
-- entrega habilitada e modalidade ativa, mesmo padrão de menor
-- privilégio já usado para products/categories (Etapa 7): nunca
-- alargado para `authenticated` (lição da Etapa 6).
create policy "anon can view enabled shipping settings of published tenants"
  on public.shipping_settings for select
  to anon
  using (
    enabled = true
    and exists (select 1 from public.tenants t where t.id = tenant_id and t.status not in ('suspended', 'deleted'))
  );

create policy "anon can view active shipping methods of published tenants with shipping enabled"
  on public.shipping_methods for select
  to anon
  using (
    status = 'active'
    and exists (select 1 from public.shipping_settings s where s.tenant_id = shipping_methods.tenant_id and s.enabled = true)
    and exists (select 1 from public.tenants t where t.id = tenant_id and t.status not in ('suspended', 'deleted'))
  );
