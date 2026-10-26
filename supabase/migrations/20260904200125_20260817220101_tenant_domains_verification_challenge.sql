-- D17.3.1 — fundação de dados para o desafio de verificação de domínio
-- (auditoria prévia: D17.3.0). Esta migration SÓ adiciona os campos de
-- metadados do desafio a `tenant_domains` — nenhuma consulta DNS, nenhuma
-- verificação real, nenhuma UI, nenhuma transição de status é implementada
-- aqui (D17.3.2/D17.3.3, ver relatório D17.3.0 seção T).
--
-- Nenhum destes campos ativa domínio nenhum: `status` continua controlado
-- exclusivamente pelo código da aplicação — `addCustomDomainAction`
-- (D17.2) continua gravando `status='pending'`/`verified_at=null` sem
-- tocar em nenhuma coluna nova aqui, e a constraint
-- `tenant_domains_status_valid` (migration 20260817220100) permanece
-- intocada: só `pending`/`verifying`/`active`, sem novo estado.
alter table public.tenant_domains
  add column verification_method text,
  -- SHA-256 (hex, 64 chars) do challenge gerado em runtime Node
  -- (lib/security/domain-challenge.ts) — NUNCA o valor em texto puro. O
  -- challenge tem 128 bits de entropia própria (crypto.randomBytes(16)),
  -- então um SHA-256 simples (sem segredo/pepper) já é seguro contra força
  -- bruta — diferente de `hashIdentifier()`
  -- (lib/security/hash-identifier.ts), que usa HMAC com segredo porque
  -- CPF/CNPJ têm entropia baixa e PRECISAM de um pepper para não serem
  -- adivinháveis por busca exaustiva. Aqui a entropia já vem do próprio
  -- valor aleatório, então HMAC seria complexidade sem ganho de segurança
  -- real.
  add column verification_token_hash text,
  add column verification_started_at timestamptz,
  add column verification_expires_at timestamptz,
  add column last_verification_at timestamptz,
  add constraint tenant_domains_verification_method_valid
    check (verification_method is null or verification_method = 'dns_txt');

comment on column public.tenant_domains.verification_method is
  'Método de prova de posse do desafio ativo (D17.3.1). Único valor aceito hoje: dns_txt (constraint tenant_domains_verification_method_valid). NULL = nenhum desafio foi iniciado ainda para este domínio.';
comment on column public.tenant_domains.verification_token_hash is
  'SHA-256 (hex) do challenge de verificação ativo — NUNCA o valor em texto puro (gerado/comparado em lib/security/domain-challenge.ts, D17.3.1). NULL = nenhum desafio ativo.';
comment on column public.tenant_domains.verification_started_at is
  'Quando o desafio ativo foi gerado (D17.3.1) — base para verification_expires_at (+72h). NULL = nenhum desafio ativo.';
comment on column public.tenant_domains.verification_expires_at is
  'verification_started_at + 72h (lib/security/domain-challenge.ts). Após este momento o desafio deixa de ser válido — a etapa que implementar a consulta DNS real (D17.3.2) decide o que fazer (gerar um novo, nunca reaproveitar o expirado). NULL = nenhum desafio ativo.';
comment on column public.tenant_domains.last_verification_at is
  'Última vez que uma consulta DNS real foi tentada para este domínio. Não implementado ainda (D17.3.2) — coluna só reservada aqui. NULL = nunca consultado.';

-- Nenhum índice novo: toda leitura/escrita futura destas colunas já passa
-- por `id`/`tenant_id` (índices existentes desde D17.1) — nenhuma consulta
-- prevista filtra por verification_method/verification_token_hash/etc.
-- isoladamente (auditoria D17.3.0, seção C).

-- RLS/policies: SEM ALTERAÇÃO. A única policy existente
-- ("anon can view active tenant domains", SELECT, status='active',
-- migration 20260817220100) continua exatamente como está — estas 5
-- colunas são metadados internos do processo de verificação. Nota de
-- risco de baixo impacto (registrada, não corrigida aqui, pois corrigir
-- exigiria alterar a policy/projeção — fora do escopo desta migration):
-- como RLS filtra linha e não coluna (mesmo raciocínio já documentado na
-- migration 20260817220093), uma consulta direta de `anon` via
-- PostgREST a um domínio `active` tecnicamente já pode ler estas 5
-- colunas novas também — nenhuma delas carrega o token em texto puro
-- (só o hash SHA-256, que não é reversível), então isso não é uma
-- exposição de segredo, mas é uma superfície de metadados desnecessária
-- que uma etapa futura (D17.3.3, ao decidir a projeção de colunas do
-- painel/storefront) deveria considerar restringir explicitamente na
-- camada de aplicação, como o storefront já faz para `tenants`
-- (`resolveStorefrontTenant`, nunca `select *`).
