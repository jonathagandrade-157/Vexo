-- Cart reads now run through the server-only service client. products
-- predates the corrected default privileges, so it never inherited SELECT
-- for service_role. PostgREST rejects the cart_items -> products embed
-- without this grant, even though service_role bypasses RLS.
-- Read-only and scoped to this existing table; no browser grants change.
grant select on table public.products to service_role;
