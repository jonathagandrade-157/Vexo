-- Etapa 9 — adicionar/incrementar item do carrinho de forma atômica.
-- supabase-js `.upsert()` só substitui colunas no conflito (não soma) —
-- uma RPC com `insert ... on conflict ... do update set quantity =
-- least(quantity + excluded.quantity, 99)` é a única forma de "somar à
-- quantidade existente, sem duplicar linha, sem ultrapassar o limite"
-- numa única instrução atômica (segura sob concorrência: dois cliques
-- quase simultâneos no mesmo produto nunca criam duas linhas nem perdem
-- um incremento). `security invoker` de propósito — roda como o papel
-- que chamou (aqui, sempre `anon`), sujeito às MESMAS RLS policies e ao
-- MESMO trigger prevent_cross_tenant_cart_item de uma escrita direta na
-- tabela — nenhum bypass, só atomicidade.
create function public.add_to_cart(
  p_tenant_id uuid,
  p_cart_id uuid,
  p_product_id uuid,
  p_quantity integer
)
returns public.cart_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.cart_items;
begin
  insert into public.cart_items (cart_id, tenant_id, product_id, quantity)
  values (p_cart_id, p_tenant_id, p_product_id, p_quantity)
  on conflict (cart_id, product_id)
  do update set quantity = least(public.cart_items.quantity + excluded.quantity, 99)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.add_to_cart(uuid, uuid, uuid, integer) is
  'Upsert atômico de item de carrinho (soma quantidade no conflito, com teto de 99) — arquitetura Etapa 9 §7/§14. security invoker: mesma RLS/trigger de uma escrita direta, sem bypass.';

revoke execute on function public.add_to_cart(uuid, uuid, uuid, integer)
  from public, authenticated, service_role;
grant execute on function public.add_to_cart(uuid, uuid, uuid, integer) to anon;
