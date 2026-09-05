-- D17.5.1 — fundação de dados para o binding do domínio customizado
-- (já verificado via DNS TXT, D17.3) ao projeto Vercel (auditoria prévia:
-- D17.5.0). Esta migration SÓ adiciona metadados do estado de binding —
-- nenhuma chamada à Vercel, nenhuma verificação de posse, nenhuma
-- transição de status VEXO acontece aqui.
--
-- Estado do domínio no VEXO (tenant_domains.status: pending/verifying/
-- active) e estado de binding na Vercel são deliberadamente eixos
-- separados (auditoria D17.5.0 §J) — nunca fundidos no mesmo campo. A
-- Vercel nunca decide qual tenant é dono de um domínio: essa autoridade
-- continua sendo exclusivamente `tenant_domains`/`tenants` no Supabase,
-- como já documentado desde a migration 20260817220100.
alter table public.tenant_domains
  add column vercel_domain_status text not null default 'not_registered',
  -- Preenchido só quando `vercel_domain_status` transiciona para
  -- 'registered' pela primeira vez — nunca reescrito depois disso por uma
  -- reconfirmação (mesmo princípio de `verified_at`, migration 20260817220100:
  -- marca QUANDO o binding foi confirmado, não "última vez que foi checado").
  add column vercel_registered_at timestamptz,
  -- Código interno seguro e curto (lib/vercel/domains.ts::VercelDomainErrorCode),
  -- nunca a mensagem/corpo bruto da resposta da API da Vercel. NULL quando
  -- não há erro (vercel_domain_status não é configuration_error/certificate_error/unknown).
  add column vercel_error_code text,
  -- Última vez que o VEXO consultou a Vercel para este domínio (registro
  -- ou check) — usado para nunca fazer polling desnecessário numa etapa
  -- futura; nesta etapa só é preenchido quando o próprio lojista aciona
  -- "Verificar novamente" na UI (D17.5.1 não implementa polling).
  add column vercel_last_checked_at timestamptz,
  add constraint tenant_domains_vercel_domain_status_valid
    check (vercel_domain_status in (
      'not_registered', 'registering', 'registered',
      'configuration_error', 'certificate_error', 'unknown'
    ));

comment on column public.tenant_domains.vercel_domain_status is
  'D17.5.1 — estado do BINDING na Vercel (infraestrutura), nunca do dado de tenant: not_registered -> registering -> registered, ou configuration_error/certificate_error/unknown em caso de falha. Eixo separado de `status` (posse DNS TXT, D17.3) — ver auditoria D17.5.0 §J.';
comment on column public.tenant_domains.vercel_registered_at is
  'Quando vercel_domain_status passou a "registered" pela primeira vez (D17.5.1). NULL enquanto não registrado.';
comment on column public.tenant_domains.vercel_error_code is
  'Código interno curto (VercelDomainErrorCode, lib/vercel/domains.ts) do último erro de binding — nunca a mensagem/corpo bruto da API da Vercel (D17.5.0 §L). NULL quando não há erro.';
comment on column public.tenant_domains.vercel_last_checked_at is
  'Última consulta do VEXO à Vercel para este domínio (registro ou check), acionada pelo lojista — D17.5.1 não implementa polling automático.';

-- Nenhum índice novo: nenhuma consulta prevista filtra por estas colunas
-- isoladamente (mesma decisão já registrada para as colunas de challenge
-- de verificação, migration 20260817220101) — toda leitura/escrita
-- continua passando por `id`/`tenant_id`, já indexados.

-- RLS/policies: SEM ALTERAÇÃO. A única policy existente ("anon can view
-- active tenant domains", SELECT, status='active', migration
-- 20260817220100) continua exatamente como está. Mesma nota de risco de
-- baixo impacto já registrada na migration 20260817220101 (RLS filtra
-- linha, não coluna) se aplica igualmente a estas 4 colunas novas — nenhuma
-- delas carrega segredo (token/hash), só metadados operacionais do
-- binding, então não é uma exposição de segredo, só a mesma superfície de
-- metadados desnecessária já observada — considerar restringir a projeção
-- de colunas na aplicação numa etapa futura, não corrigido aqui.
