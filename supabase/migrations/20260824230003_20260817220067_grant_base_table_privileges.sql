-- Correção de infraestrutura (não uma Etapa de produto) — corrige a
-- causa raiz do ERROR 42501 encontrado no fluxo de cadastro em
-- produção: todas as migrations do VEXO foram aplicadas conectando
-- como o papel `postgres`, cujo default privilege neste projeto
-- Supabase só concede TRUNCATE/REFERENCES/TRIGGER a
-- anon/authenticated/service_role (não SELECT/INSERT/UPDATE/DELETE),
-- diferente do default de `supabase_admin`, que já vem completo.
--
-- Cada GRANT abaixo corresponde ao que o código realmente executa
-- hoje via `.from(tabela).<verbo>()` — nunca ao que a RLS
-- simplesmente permite. A RLS de cada tabela continua sendo a
-- autoridade sobre QUAIS linhas cada operação alcança; isto só abre
-- a operação em si, na camada abaixo da RLS.
--
-- Idempotente: todo GRANT é reaplicável sem erro (Postgres não
-- duplica privilégios já concedidos).

-- profiles
grant select, update on public.profiles to authenticated;

-- tenants
grant select on public.tenants to anon;
grant select, update on public.tenants to authenticated;

-- tenant_members (nunca insert/update/delete direto — só via create_tenant() RPC)
grant select on public.tenant_members to authenticated;

-- trial_records (nunca insert/update direto — só via start_trial_for_tenant()/trigger)
grant select on public.trial_records to authenticated;

-- subscriptions (nunca insert/update direto hoje — só via trigger link_trial_to_subscription)
grant select on public.subscriptions to authenticated;

-- plan_limits (só MASTER, nunca anon)
grant select, insert, update, delete on public.plan_limits to authenticated;

-- plans (nunca delete)
grant select on public.plans to anon;
grant select, insert, update on public.plans to authenticated;

-- features (nunca delete)
grant select on public.features to anon;
grant select, insert, update on public.features to authenticated;

-- plan_features (nunca update — é sempre insert/delete do par plan_id+feature_id)
grant select on public.plan_features to anon;
grant select, insert, delete on public.plan_features to authenticated;

-- products
grant select on public.products to anon;
grant select, insert, update, delete on public.products to authenticated;

-- categories
grant select on public.categories to anon;
grant select, insert, update, delete on public.categories to authenticated;

-- shipping_methods
grant select on public.shipping_methods to anon;
grant select, insert, update, delete on public.shipping_methods to authenticated;

-- shipping_settings (nunca delete)
grant select on public.shipping_settings to anon;
grant select, insert, update on public.shipping_settings to authenticated;

-- store_payment_providers (nunca delete, nunca anon)
grant select, insert, update on public.store_payment_providers to authenticated;

-- orders (leitura só; escrita via create_order_from_cart() RPC)
grant select on public.orders to authenticated, service_role;

-- order_items (leitura só)
grant select on public.order_items to authenticated;

-- payments (leitura só; escrita via RPCs de pagamento)
grant select on public.payments to authenticated;

-- audit_logs (leitura só; escrita via trigger log_audit())
grant select on public.audit_logs to authenticated;

-- platform_admins (leitura só)
grant select on public.platform_admins to authenticated;

-- payment_webhook_events (só service_role, sem RLS, sem sessão de usuário)
grant select, insert, update on public.payment_webhook_events to service_role;

-- cart_items, carts, payment_credentials_vault, trial_eligibility,
-- roles, permissions, role_permissions: SEM MUDANÇA nesta migration —
-- os dois primeiros já têm o GRANT correto; os quatro últimos
-- permanecem sem GRANT (os dois primeiros por design de segurança —
-- só SECURITY DEFINER; os dois últimos porque nenhum código os usa
-- diretamente ainda, apesar da RLS já permitir).

-- Revoga os privilégios herdados do default incorreto que nenhum
-- papel de app deveria ter (TRUNCATE não é coberto por RLS — é uma
-- exposição real hoje).
revoke truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- Corrige o default para toda tabela FUTURA criada por uma migration
-- rodando como `postgres` (o que sempre acontece neste projeto) —
-- sem isto, a próxima migration nova repete o incidente inteiro.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
