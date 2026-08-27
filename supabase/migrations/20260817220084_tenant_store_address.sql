-- Fase D2-B.2 (endereço da loja) — auditoria concluiu que hoje não existe
-- NENHUMA fonte de endereço da loja no schema: `shipping_settings.origin_zip`
-- é só um CEP (nullable mesmo com frete habilitado, nunca resolvido para
-- cidade/UF em lugar nenhum do código) e `orders.shipping_address` é o
-- endereço do CLIENTE por pedido, não da loja. Nenhum dos dois serve como
-- fonte única de origem para PIX/entrega própria/Melhor Envio.
--
-- Decisão de arquitetura (documentada na auditoria, não escolhida
-- automaticamente): colunas escalares em `tenants` (mesmo padrão já usado
-- 4 vezes no projeto — tenant_brand_info/tenant_appearance_fields/
-- tenant_checkout_mode/tenant_pix_settings — configuração 1:1 por tenant,
-- sem histórico). Rejeitada uma tabela `tenant_store_address` própria: o
-- único critério que já justificou uma tabela separada no projeto
-- (shipping_settings/shipping_methods) foi `shipping_methods` ser
-- genuinamente 1:N — não é o caso aqui (uma loja, um endereço de origem
-- nesta fase). 7 colunas não é mais do que `tenant_brand_info` (5) e
-- `tenant_pix_settings` (4) já misturadas na mesma tabela.
--
-- `address_number`/`address_complement` são SEMPRE preenchidos manualmente
-- pelo lojista (a consulta de CEP nunca devolve isso). `address_city`
-- guarda o valor COM acentos, exatamente como veio da consulta/como o
-- lojista digitou — a sanitização (maiúsculas, sem acento, truncado a 15
-- chars) exigida pelo padrão EMV do BR Code acontece só no momento de
-- montar o payload PIX (fase futura, `lib/pix/payload.ts`), nunca aqui.
alter table public.tenants
  add column address_zip text
    check (address_zip is null or address_zip ~ '^[0-9]{8}$'),
  add column address_street text
    check (char_length(address_street) <= 200),
  add column address_number text
    check (char_length(address_number) <= 20),
  add column address_complement text
    check (char_length(address_complement) <= 100),
  add column address_neighborhood text
    check (char_length(address_neighborhood) <= 100),
  add column address_city text
    check (char_length(address_city) <= 100),
  add column address_state text
    check (
      address_state is null or address_state in (
        'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
        'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
      )
    );

comment on column public.tenants.address_zip is
  'CEP da loja (só dígitos, 8 chars) — origem oficial da loja para PIX (Merchant City do BR Code)/entrega própria/Melhor Envio (futuro). Preenchido via autofill (BrasilAPI v2, lib/address/cep-lookup.ts) ou manualmente; nunca bloqueia o cadastro se a consulta falhar.';
comment on column public.tenants.address_number is
  'Sempre digitado manualmente pelo lojista — nenhum serviço de CEP devolve número/complemento.';
comment on column public.tenants.address_complement is
  'Sempre digitado manualmente pelo lojista (opcional). Nunca preenchido por autofill.';
comment on column public.tenants.address_city is
  'Cidade da loja, salva COM acentos (exibição/cadastro). O gerador de BR Code (fase futura) sanitiza este valor (maiúsculas, sem acento, truncado a 15 chars) só no momento de montar o payload PIX — nunca reformatado aqui. Exigida (ver tenants_pix_enabled_requires_key_check abaixo) sempre que pix_enabled=true.';

-- Endereço em si é opcional e pode ficar incompleto (nenhuma exigência de
-- "tudo ou nada" nesta fase — diferente de PIX/checkout_mode, não há
-- "endereco_enabled"): útil mesmo parcial para Configurações mostrar o que
-- já foi digitado. A única exigência de completude concreta desta fase é
-- cruzada com PIX, abaixo.
--
-- Estende a constraint já existente (migration 083) — nunca permitir
-- pix_enabled=true sem cidade da loja, senão o BR Code (fase futura) não
-- teria como montar o campo obrigatório Merchant City. Mesmo defense-in-
-- depth já usado para pix_key/pix_key_type/pix_recipient_name.
alter table public.tenants drop constraint tenants_pix_enabled_requires_key_check;
alter table public.tenants
  add constraint tenants_pix_enabled_requires_key_check
    check (
      pix_enabled = false
      or (
        pix_key is not null
        and pix_key_type is not null
        and pix_recipient_name is not null
        and address_city is not null
      )
    );

-- Nenhuma policy nova: a policy de UPDATE de tenants (settings.update) já
-- cobre as colunas novas (RLS protege linha, não coluna) — mesmo
-- raciocínio já registrado em tenant_appearance_fields/tenant_checkout_mode/
-- tenant_pix_settings. A policy de SELECT pública (anon) também já cobre
-- automaticamente, necessária para o checkout ler a cidade quando o
-- gerador de BR Code for implementado.
--
-- `shipping_settings.origin_zip` permanece intocado nesta fase — nenhuma
-- migration antiga foi alterada/removida. Registrado para D3: candidato
-- natural é `shipping_settings.origin_zip` passar a ser derivado de
-- `tenants.address_zip` (ou substituído por ele) quando o frete por
-- distância for implementado — decisão de D3, não desta migration.
