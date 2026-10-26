-- Sprint 1 — Fase A (Aparência da loja) — logo, cor primária/secundária e
-- modelo visual escolhido pelo lojista. Colunas aditivas diretamente em
-- public.tenants, mesmo padrão já usado para os 6 campos de perfil da
-- loja (migration 20260817220018_tenant_brand_info.sql): são escalares
-- 1:1 com o tenant, sem histórico, sem N:1 — não justificam uma tabela
-- storefront_settings própria (mesma decisão, mesmo motivo).
--
-- Todas nullable/com default seguro — nenhuma loja existente (nem as já
-- em produção) quebra, nenhum preenchimento é obrigatório:
--   logo_url is null            -> storefront usa o fallback atual (sem logo)
--   primary_color is null       -> storefront usa a cor padrão do design system
--   secondary_color is null     -> idem
--   storefront_template default -> 'commerce' (VEXO Commerce, o recomendado)
--
-- `logo_url`, apesar do nome, guarda um PATH dentro do bucket
-- tenant-media (migration seguinte), nunca uma URL completa — mesmo
-- padrão de products.main_image (Etapa 8): a URL pública é sempre montada
-- em runtime a partir do path + NEXT_PUBLIC_SUPABASE_URL, nunca persistida
-- pronta (evita quebrar tudo se o projeto Supabase mudar de domínio).
alter table public.tenants
  add column logo_url text,
  add column primary_color text,
  add column secondary_color text,
  add column storefront_template text not null default 'commerce';

-- Nunca aceitar CSS arbitrário como cor — só o formato estrito #RRGGBB
-- (Sprint 1 Fase A, requisito explícito de segurança).
alter table public.tenants
  add constraint tenants_primary_color_format
    check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.tenants
  add constraint tenants_secondary_color_format
    check (secondary_color is null or secondary_color ~ '^#[0-9A-Fa-f]{6}$');

-- Os 5 modelos da Sprint 1 (nomes fixos, definidos no relatório da
-- Fase A) — nesta fase a coluna só guarda a ESCOLHA feita no painel; a
-- storefront pública continua renderizando do jeito que renderiza hoje
-- até uma fase futura implementar os 5 layouts de verdade.
alter table public.tenants
  add constraint tenants_storefront_template_check
    check (storefront_template in ('commerce', 'premium', 'minimal', 'editorial', 'fashion'));

comment on column public.tenants.logo_url is
  'Path do objeto de logo no bucket tenant-media (nunca a URL completa) — mesmo padrão de products.main_image. NULL = loja sem logo, storefront usa o fallback atual (Sprint 1 Fase A).';
comment on column public.tenants.primary_color is
  'Cor primária de personalização da loja, formato #RRGGBB estrito (CHECK constraint) — nunca CSS arbitrário. NULL = usa a cor padrão do design system.';
comment on column public.tenants.secondary_color is
  'Cor secundária de personalização da loja, mesma regra/formato de primary_color.';
comment on column public.tenants.storefront_template is
  'Modelo visual escolhido pelo lojista no painel (Sprint 1 Fase A: commerce/premium/minimal/editorial/fashion). Nesta fase controla só a seleção no painel — a renderização real dos 5 modelos na loja pública fica para uma fase futura. Default ''commerce'' (VEXO Commerce, o recomendado).';

-- Nenhuma policy nova: a policy de UPDATE de tenants já existente
-- ("tenant staff with settings.update can update their tenant",
-- migration 20260817220012 — using/with check has_permission(id,
-- 'settings.update') or is_platform_admin()) já cobre qualquer coluna
-- nova da mesma linha. RLS protege linha, não coluna — nada a fazer
-- aqui. O trigger prevent_unauthorized_tenant_status_change (mesma
-- migration) só protege a coluna `status`, que esta migration não toca.
