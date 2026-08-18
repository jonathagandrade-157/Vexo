-- Etapa 4 — dados básicos da loja + rastreamento de conclusão do
-- onboarding (arquitetura §6, §25.1; ver docs/architecture/etapa-4-onboarding.md).
--
-- Colunas novas em `tenants` em vez de uma tabela separada: são todas
-- escalares 1:1 com o tenant, exatamente os campos da tela
-- onboarding_sobre_sua_marca do Stitch — não há necessidade (ainda) de uma
-- tabela `store_settings` própria para seis colunas simples.
--
-- Sem nova policy de RLS: a policy de UPDATE já existente (0012 —
-- "tenant staff with settings.update can update their tenant") já cobre
-- estas colunas, porque RLS do Postgres não filtra coluna a coluna, apenas
-- linha a linha — quem já podia fazer UPDATE em tenants.name (OWNER/ADMIN,
-- via has_permission(id, 'settings.update')) já pode gravar estas também.
-- Nenhuma proteção da Etapa 2 é enfraquecida por isso: o trigger
-- prevent_unauthorized_tenant_status_change continua sendo o único jeito
-- de mudar `status`, e tenant_id/slug continuam fora deste UPDATE.
alter table public.tenants
  add column segment text
    check (segment in ('apparel', 'electronics', 'beauty', 'home', 'other')),
  add column description text
    check (char_length(description) <= 500),
  add column instagram_handle text
    check (char_length(instagram_handle) <= 60),
  add column whatsapp_phone text
    check (char_length(whatsapp_phone) <= 30),
  add column contact_email text
    check (char_length(contact_email) <= 254),
  add column onboarding_completed_at timestamptz;

comment on column public.tenants.segment is
  'Segmento da loja, coletado no onboarding (Etapa 4). Valores fixos = os 5 <option> da tela onboarding_sobre_sua_marca do Stitch.';
comment on column public.tenants.onboarding_completed_at is
  'NULL = onboarding pendente/em progresso; preenchido = concluído. Único mecanismo de conclusão — determinável inteiramente no servidor, nunca em localStorage/sessionStorage/cookie/estado de cliente (arquitetura §24 Etapa 4). Gravado por features/onboarding/actions.ts via UPDATE (idempotente: reenvio não duplica).';
