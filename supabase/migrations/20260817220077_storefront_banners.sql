-- Sprint 1 — Fase C2 (início) — carrossel de banners do storefront
-- (arquitetura já desenhada na auditoria da Fase C1). Mesmo molde exato
-- de `shipping_methods` (20260817220046): 1:N por tenant, `status`
-- active/inactive, `sort_order`, CRUD via `settings.update` (não uma
-- permissão `banners.*` dedicada — banner é identidade visual da loja,
-- mesmo domínio de logo/cores/modelo), leitura pública restrita a
-- `anon` + linha ativa + tenant não suspenso/excluído.
create table public.storefront_banners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  -- Path no bucket `tenant-media` (migration 20260817220076), nunca a
  -- URL completa — mesmo padrão de `tenants.logo_url`/`products.main_image`.
  image_path text not null,
  link_url text,
  title text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index storefront_banners_tenant_id_idx on public.storefront_banners (tenant_id);

comment on table public.storefront_banners is
  'Banners do carrossel do Hero da storefront pública, um tenant tem até 5 (limite validado na Server Action, não aqui). Sprint 1 — Fase C2.';
comment on column public.storefront_banners.image_path is
  'Path dentro do bucket tenant-media ({tenant_id}/banners/{banner_id}.{ext}), nunca a URL pública completa.';

create trigger set_updated_at
  before update on public.storefront_banners
  for each row
  execute function private.set_updated_at();

-- Reaproveita o trigger genérico da Etapa 2 — "anexar em toda tabela
-- com tenant_id, presente e futura". Não duplica a lógica.
create trigger prevent_tenant_id_change
  before update on public.storefront_banners
  for each row
  execute function private.prevent_tenant_id_change();

alter table public.storefront_banners enable row level security;
alter table public.storefront_banners force row level security;

-- Escrita: só staff com settings.update do próprio tenant — nunca outro
-- tenant, nunca anon. Mesma permissão que já governa logo/cores/modelo
-- (features/settings/appearance-actions.ts), não uma nova.
create policy "tenant members can view storefront banners"
  on public.storefront_banners for select
  to authenticated
  using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

create policy "tenant staff with settings.update can insert storefront banners"
  on public.storefront_banners for insert
  to authenticated
  with check (private.has_permission(tenant_id, 'settings.update'));

create policy "tenant staff with settings.update can update storefront banners"
  on public.storefront_banners for update
  to authenticated
  using (private.has_permission(tenant_id, 'settings.update'))
  with check (private.has_permission(tenant_id, 'settings.update'));

create policy "tenant staff with settings.update can delete storefront banners"
  on public.storefront_banners for delete
  to authenticated
  using (private.has_permission(tenant_id, 'settings.update'));

-- Leitura pública (storefront/preview, anon) — só banners ativos de uma
-- loja publicamente visível, mesmo padrão de menor privilégio já usado
-- em products/categories/shipping_methods.
create policy "anyone can view active storefront banners of publicly visible tenants"
  on public.storefront_banners for select
  to anon
  using (
    status = 'active'
    and exists (select 1 from public.tenants t where t.id = tenant_id and t.status not in ('suspended', 'deleted'))
  );

-- Toda tabela criada depois da migration 20260817220067 herda por
-- padrão select/insert/update/delete para anon E authenticated (o
-- default privilege corrigido ali) — mais permissivo do que anon
-- deveria ter aqui (nunca escreve banner). Revoga tudo e concede de
-- novo só o necessário, mesmo padrão defensivo de `billing_invoices`
-- (20260817220071): a RLS já bloquearia a escrita de anon de qualquer
-- forma (nenhuma policy de insert/update/delete cobre `anon`), mas não
-- deixamos o GRANT bruto mais aberto do que precisa.
revoke all on public.storefront_banners from anon, authenticated;
grant select on public.storefront_banners to anon;
grant select, insert, update, delete on public.storefront_banners to authenticated;
