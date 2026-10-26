-- Fase D2-B (revisão final) — PIX direto sem gateway (§5/§6/§22 do
-- prompt). Antes de criar qualquer estrutura, auditei o que já existe:
--
--   A) coluna(s) em tenants (mesmo padrão de tenant_brand_info —
--      20260817220018 — tenant_appearance_fields — 20260817220075 — e
--      tenant_checkout_mode — 20260817220078: configuração 1:1 por
--      tenant, sem histórico, sem N:1);
--   B) tabela própria pix_settings 1:1;
--   C) reaproveitar alguma estrutura existente (store_payment_providers,
--      payment_credentials_vault) — descartado de propósito: aquelas
--      tabelas são para o Mercado Pago (OAuth, tokens reais, segredo
--      cifrado no Vault) — a chave PIX aqui NUNCA é um segredo (é
--      literalmente exibida ao cliente no checkout) e não tem tokens/
--      OAuth/expiração nenhuma. Misturar os dois modelos no mesmo lugar
--      confundiria "credencial secreta de gateway" com "dado público de
--      recebimento exibido na tela".
--
-- Escolhida (A): são 4 campos escalares (liga/desliga, chave, tipo da
-- chave, nome do recebedor), sem histórico de mudanças necessário nesta
-- fase, sem nenhuma tabela irmã 1:N que justificasse uma tabela própria
-- (diferente de shipping_settings, que sempre teve shipping_methods ao
-- lado) — exatamente o mesmo formato já usado 3 vezes no projeto.
alter table public.tenants
  add column pix_enabled boolean not null default false,
  add column pix_key text,
  add column pix_key_type text,
  add column pix_recipient_name text;

alter table public.tenants
  add constraint tenants_pix_key_type_check
    check (pix_key_type is null or pix_key_type in ('cpf_cnpj', 'email', 'phone', 'random'));

-- Nunca liga o PIX direto sem ter os 3 campos preenchidos — mesma
-- garantia de banco que shipping_settings.enabled=true não tem hoje
-- (shipping permite habilitar sem nenhuma modalidade cadastrada, uma
-- lacuna conhecida daquele domínio) — aqui fechamos isso desde o início,
-- porque "PIX habilitado sem chave" quebraria o checkout de verdade (o
-- cliente veria a opção mas nenhuma chave para pagar).
alter table public.tenants
  add constraint tenants_pix_enabled_requires_key_check
    check (
      pix_enabled = false
      or (pix_key is not null and pix_key_type is not null and pix_recipient_name is not null)
    );

comment on column public.tenants.pix_enabled is
  'Liga/desliga o PIX direto sem gateway no fluxo WhatsApp (Fase D2-B). Nunca true sem pix_key/pix_key_type/pix_recipient_name preenchidos (ver tenants_pix_enabled_requires_key_check).';
comment on column public.tenants.pix_key is
  'Chave PIX da CONTA DO PRÓPRIO LOJISTA — a VEXO nunca gera nem processa esta chave, só a exibe ao cliente no checkout e na mensagem do WhatsApp. Não é segredo (fica visível no checkout), por isso nunca no Vault (diferente de payment_credentials_vault). Normalizada por tipo antes de salvar (features/settings/pix-schema.ts::normalizePixKey) — nunca reformatada em runtime a partir do texto bruto.';
comment on column public.tenants.pix_key_type is
  'cpf_cnpj | email | phone | random — determina a validação de formato aplicada a pix_key (nunca confirma que a chave realmente existe/pertence ao lojista, só o formato).';
comment on column public.tenants.pix_recipient_name is
  'Nome exibido ao cliente junto da chave, para conferência antes do pagamento (nunca usado para nenhuma verificação automática).';

-- Nenhuma policy nova: a policy de UPDATE de tenants já existente
-- ("tenant staff with settings.update can update their tenant") já cobre
-- as colunas novas da mesma linha (RLS protege linha, não coluna); a
-- policy de SELECT pública (anon) de tenants já existente também cobre
-- automaticamente — é o mesmo raciocínio já registrado em
-- tenant_appearance_fields/tenant_checkout_mode, e é necessário aqui de
-- propósito: o checkout precisa ler pix_key/pix_recipient_name como
-- `anon` para exibir ao cliente.
