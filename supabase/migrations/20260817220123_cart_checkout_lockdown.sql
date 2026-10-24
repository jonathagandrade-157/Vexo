-- Etapa 2A (contração/lockdown) — aplicar somente depois de a aplicação
-- com o BFF de carrinho estar publicada. Remove todo acesso direto de
-- visitantes às tabelas e às RPCs privilegiadas do checkout.

drop policy if exists "anon can create a cart for a published tenant" on public.carts;
drop policy if exists "anon can read carts of published tenants" on public.carts;
drop policy if exists "anon can add items to a published tenant's cart" on public.cart_items;
drop policy if exists "anon can read cart items of published tenants" on public.cart_items;
drop policy if exists "anon can update cart items of published tenants" on public.cart_items;
drop policy if exists "anon can delete cart items of published tenants" on public.cart_items;

revoke all privileges on table public.carts from public, anon, authenticated;
revoke all privileges on table public.cart_items from public, anon, authenticated;
grant select, insert, update, delete on table public.carts to service_role;
grant select, insert, update, delete on table public.cart_items to service_role;

-- add_to_cart continua reutilizado pelo BFF, mas não é mais invocável
-- com a anon key. A autorização do carrinho é feita antes no servidor.
revoke execute on function public.add_to_cart(uuid, uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.add_to_cart(uuid, uuid, uuid, integer, uuid)
  to service_role;

-- Implementações privilegiadas: nunca expostas a anon/authenticated.
-- O BFF usa checkout_cart_secure; service_role permanece autorizado para
-- testes de integração, recuperação operacional e composição de RPCs.
revoke execute on function public.create_order_from_cart(
  uuid, uuid, text, text, text, jsonb, text, text, text, numeric
) from public, anon, authenticated, service_role;
grant execute on function public.create_order_from_cart(
  uuid, uuid, text, text, text, jsonb, text, text, text, numeric
) to service_role;

revoke execute on function public.apply_shipping_to_order(uuid, uuid, uuid, numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_shipping_to_order(uuid, uuid, uuid, numeric)
  to service_role;
revoke execute on function public.apply_melhor_envio_shipping_to_order(
  uuid, uuid, text, text, numeric, integer
) from public, anon, authenticated, service_role;
grant execute on function public.apply_melhor_envio_shipping_to_order(
  uuid, uuid, text, text, numeric, integer
) to service_role;

-- Pagamento também é iniciado exclusivamente pelo módulo server-only.
revoke execute on function public.create_payment_for_order(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_payment_for_order(uuid, uuid, text)
  to service_role;
revoke execute on function public.attach_payment_preference(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.attach_payment_preference(uuid, uuid, text)
  to service_role;
