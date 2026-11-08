-- Confirmação de pedido deixa de ser legível pela API pública.
--
-- Antes: get_order_confirmation(tenant_id, order_id) era SECURITY DEFINER
-- com EXECUTE para anon. Como a chave anon/publishable é pública por
-- definição, quem conhecesse o par (tenant, pedido) — por exemplo pela URL
-- da confirmação — lia nome, endereço e itens do comprador diretamente via
-- PostgREST, sem passar pela página.
--
-- Agora: a página valida no servidor uma prova assinada (tenant, pedido,
-- expiração; lib/security/order-access-token.ts) e só então lê a
-- confirmação com service_role. Esta migration move o EXECUTE de anon para
-- service_role. Não altera dados, RLS, assinatura nem corpo da função.
--
-- Rollout: o código publicado tenta service_role primeiro e só recorre a
-- anon quando o banco responde 42501 (migration ainda não aplicada), então
-- código e migration podem ser publicados em qualquer ordem. Rollback:
--   grant execute on function public.get_order_confirmation(uuid, uuid) to anon;
-- (reabre a exposição; só usar se o código novo for revertido).

revoke execute on function public.get_order_confirmation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_order_confirmation(uuid, uuid) to service_role;

comment on function public.get_order_confirmation(uuid, uuid) is
  'Confirmação do pedido para o comprador — exclusiva de service_role desde 20261107120000. A página valida antes uma prova de posse assinada (tenant/pedido/expiração); o order_id sozinho não é credencial. Projeta só o necessário para a tela, nunca internal_note nem dados administrativos.';
