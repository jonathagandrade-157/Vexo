-- D3.2-B — Correção de infraestrutura (achado da auditoria pós-087/088,
-- não uma nova Etapa de produto). `shipping_credentials_vault` foi criada
-- pela migration 20260817220087, que roda DEPOIS de
-- 20260817220067_grant_base_table_privileges (que alterou os default
-- privileges de toda tabela FUTURA criada pelo role `postgres` para já
-- nascer com select/insert/update/delete concedido a
-- anon/authenticated/service_role). A 087 fez o revoke+regrant explícito
-- necessário para `store_shipping_providers`, mas não fez o mesmo para
-- `shipping_credentials_vault` — resultado: `anon`/`authenticated`
-- acabaram com SELECT/INSERT/UPDATE/DELETE de tabela nesta tabela de
-- segredos, ao contrário de `payment_credentials_vault` (criada ANTES da
-- 067, portanto sem nenhum grant herdado para esses dois roles).
--
-- Isso nunca expôs nenhum segredo em produção: RLS forçada + zero policy
-- em `shipping_credentials_vault` (ambas inalteradas por esta migration)
-- já bloqueiam qualquer SELECT/INSERT/UPDATE/DELETE de `anon`/
-- `authenticated` independente do grant de tabela (nenhum papel sem
-- BYPASSRLS consegue satisfazer uma policy que não existe). Esta
-- migration só alinha o grant de tabela ao mesmo desenho de
-- `payment_credentials_vault` (defesa em profundidade: nenhum grant
-- direto, não só RLS), sem alterar RLS, policies, funções `private.*`
-- ou o grant de `service_role` (necessário para os RPCs
-- SECURITY DEFINER continuarem funcionando).
--
-- Escopo estritamente estas três linhas — nenhuma outra tabela, nenhuma
-- alteração em `store_shipping_providers`, `order_items` ou `tenants`.
revoke all on table public.shipping_credentials_vault from anon;
revoke all on table public.shipping_credentials_vault from authenticated;
revoke all on table public.shipping_credentials_vault from public;
