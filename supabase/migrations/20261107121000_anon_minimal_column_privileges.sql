-- Respostas públicas só com o necessário (minimização de dados).
--
-- A RLS de `tenants` para anon é por LINHA (toda loja não suspensa). Com
-- SELECT na tabela inteira, a chave anon/publishable — pública por
-- definição — permitia listar pela API, de todas as lojas: chave PIX,
-- titular PIX, endereço completo, created_by (UUID do dono) e, em
-- tenant_domains, o hash do desafio de verificação e erros internos da
-- Vercel. A vitrine nunca precisou dessas colunas via anon: PIX e endereço
-- agora são lidos no servidor (service_role), escopados pelo tenant já
-- resolvido (features/checkout/pix-settings.ts, store-address.ts).
--
-- Também remove INSERT/UPDATE/DELETE de anon herdados dos default
-- privileges (migration 20260817220067). Nenhuma policy de escrita existe
-- para anon — a RLS já negava —, então isto é defesa em profundidade sem
-- mudança de comportamento.
--
-- Não altera dados nem policies. Rollback:
--   grant select on public.tenants, public.tenant_domains to anon;

revoke select on table public.tenants from anon;
grant select (
  id, name, slug, status, segment, description, instagram_handle, whatsapp_phone,
  contact_email, onboarding_completed_at, logo_url, primary_color, secondary_color,
  storefront_template, checkout_mode
) on table public.tenants to anon;

revoke select on table public.tenant_domains from anon;
grant select (tenant_id, domain, status) on table public.tenant_domains to anon;

do $$
declare
  v_table text;
begin
  for v_table in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v')
      and (has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE')
        or has_table_privilege('anon', c.oid, 'DELETE'))
  loop
    execute format('revoke insert, update, delete, truncate on table public.%I from anon', v_table);
  end loop;
end;
$$;

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon;
