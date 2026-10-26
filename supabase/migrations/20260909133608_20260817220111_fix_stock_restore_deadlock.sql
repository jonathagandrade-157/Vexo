-- D19.1.3.3 — corrige o achado NOVO da Security Review D19.1.3.2 (MEDIUM,
-- não confundir com o M1 original de D19.1.3, já corrigido em
-- 20260817220110): a restauração de estoque em update_order_status podia
-- deadlockar (SQLSTATE 40P01) quando dois PEDIDOS DIFERENTES do mesmo
-- tenant, compartilhando 2+ produtos com controle de estoque, eram
-- cancelados quase simultaneamente. Reproduzido empiricamente em 4 de 5
-- tentativas (pedido A com itens em ordem P1→P2→P3→P4, pedido B com os
-- mesmos produtos em ordem P4→P3→P2→P1, cancelamento concorrente).
--
-- CAUSA RAIZ (não é "faltava ORDER BY" — ORDER BY nem é sintaxe válida em
-- UPDATE): a versão anterior usava um único UPDATE ... FROM order_items
-- (comando SET-based, não um loop). A ordem em que esse comando visita/
-- trava as linhas de product_inventory durante o JOIN contra order_items é
-- decidida pelo plano de execução (plan de join, ordem física das
-- páginas, estatísticas) — não existe NENHUMA garantia sintática de ordem
-- de aquisição de locks nesse tipo de comando, ao contrário de um loop
-- `FOR ... IN SELECT ... ORDER BY`, onde o PostgreSQL garante que a
-- consulta produz linhas na ordem pedida e o loop as processa (logo,
-- trava cada uma) estritamente nessa ordem — é exatamente essa garantia
-- (não uma coincidência sintática) que já torna create_order_from_cart
-- (M1, 20260817220110) livre de deadlock, confirmado por reprodução
-- empírica independente (3/3 tentativas concorrentes sem deadlock,
-- D19.1.3.2 §C).
--
-- CORREÇÃO: troca o UPDATE ... FROM por um loop FOR ... IN SELECT ...
-- ORDER BY product_id, com um UPDATE individual por produto dentro do
-- loop — o MESMO padrão, com a MESMA ordem canônica (crescente por
-- product_id) já usada no loop de decremento de create_order_from_cart.
-- Isso não apenas resolve restauração-vs-restauração (o cenário
-- reproduzido): como os dois ÚNICOS caminhos do sistema que travam mais
-- de uma linha de product_inventory na mesma transação (decremento no
-- checkout e restauração no cancelamento) agora usam a mesma ordem total,
-- nenhuma transação concorrente que toque múltiplas linhas de
-- product_inventory pode mais adquirir esses locks em ordem cruzada —
-- elimina a classe de deadlock estruturalmente, não só o caso específico
-- reproduzido.
--
-- (Ajuste manual de estoque pelo lojista, features/products/actions.ts,
-- sempre grava/upserta no máximo UM product_inventory por vez — nunca
-- trava mais de uma linha na mesma transação, então nunca participa desta
-- disputa de ordem.)
--
-- Nenhuma outra regra muda: mesma assinatura, mesma checagem de
-- permissão, mesma máquina de estados, mesmo compare-and-swap contra
-- concorrência, mesmo comportamento conservador para item sem
-- product_inventory correspondente (produto excluído ou controle de
-- estoque removido depois da compra) — só a estratégia de restauração é
-- reescrita.
create or replace function public.update_order_status(
  p_tenant_id uuid,
  p_order_id uuid,
  p_new_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_allowed boolean;
  v_restore_item record;
begin
  select private.has_permission(p_tenant_id, 'orders.update') into v_allowed;
  if not (coalesce(v_allowed, false) or private.is_platform_admin()) then
    raise exception 'insufficient permission to update this order' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id and tenant_id = p_tenant_id;
  if v_order.id is null then
    raise exception 'order not found for this store' using errcode = 'P0002';
  end if;

  if not (
    (v_order.status = 'PENDING' and p_new_status = 'CANCELLED')
    or (v_order.status = 'PAID' and p_new_status in ('PREPARING', 'CANCELLED'))
    or (v_order.status = 'PREPARING' and p_new_status in ('SHIPPED', 'CANCELLED'))
    or (v_order.status = 'SHIPPED' and p_new_status = 'DELIVERED')
  ) then
    raise exception 'invalid order status transition from % to %', v_order.status, p_new_status using errcode = 'P0001';
  end if;

  update public.orders
  set status = p_new_status,
      internal_note = p_note
  where id = p_order_id and tenant_id = p_tenant_id and status = v_order.status;

  if not found then
    raise exception 'order status changed concurrently, please retry' using errcode = '40001';
  end if;

  -- D19.1.3.3 — restaura estoque reservado em ordem canônica crescente de
  -- product_id (mesma ordem do loop de decremento em
  -- create_order_from_cart) — previne deadlock entre cancelamentos
  -- concorrentes de pedidos diferentes que compartilham produtos (ver
  -- comentário de causa raiz acima do CREATE). Itens sem
  -- product_inventory correspondente hoje (produto excluído,
  -- oi.product_id is null via ON DELETE SET NULL — 20260817220033 — ou
  -- controle de estoque removido pelo lojista desde a compra) são
  -- naturalmente ignorados: o UPDATE individual simplesmente não encontra
  -- linha e não afeta nada, sem erro (mesmo comportamento conservador de
  -- antes, nunca recria uma linha de estoque removida).
  if p_new_status = 'CANCELLED' then
    for v_restore_item in
      select oi.product_id, oi.quantity
      from public.order_items oi
      where oi.order_id = p_order_id
        and oi.tenant_id = p_tenant_id
        and oi.stock_reserved
        and oi.product_id is not null
      order by oi.product_id
    loop
      update public.product_inventory
      set stock_quantity = stock_quantity + v_restore_item.quantity,
          updated_at = now()
      where product_id = v_restore_item.product_id
        and tenant_id = p_tenant_id;
    end loop;
  end if;
end;
$$;

comment on function public.update_order_status(uuid, uuid, text, text) is
  'Único caminho para avançar orders.status depois da criação do pedido — valida a transição numa máquina de estados exaustiva no servidor, nunca confia num status vindo do cliente. Nunca altera payment_status nem dispara nenhuma operação financeira externa. D19.1.3.1: quando a transição resulta em CANCELLED, restaura atomicamente (mesma transação) o estoque de todo order_item com stock_reserved=true — idempotente por construção (CANCELLED é terminal na máquina de estados; o compare-and-swap já existente garante que a transição só acontece uma vez, mesmo sob concorrência/retry). D19.1.3.3: restauração feita via loop FOR...IN ORDER BY product_id (não mais UPDATE...FROM set-based) — mesma ordem canônica do decremento em create_order_from_cart, elimina deadlock (40P01) entre cancelamentos concorrentes de pedidos diferentes compartilhando produtos.';
