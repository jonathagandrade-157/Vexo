-- Fase D2-B — distingue como um pedido foi criado (order_source) de como
-- seu pagamento é tratado (payment_channel). Auditoria D2-A (§1/§3): os
-- dois eixos são ortogonais — hoje 1:1 correlacionados (whatsapp sempre
-- vem com external), mas um pedido `both` pago pelo checkout VEXO e um
-- futuro "combinar na entrega" dentro do próprio checkout VEXO já
-- quebrariam essa correlação se fosse um único campo.
--
-- order_source: por qual fluxo de UI o cliente criou o pedido. Vocabulário
-- deliberadamente diferente de tenants.checkout_mode (vexo/whatsapp/both,
-- migration 20260817220078) — checkout_mode é a CONFIGURAÇÃO da loja ("o
-- que ela oferece"), order_source é um FATO do pedido ("qual caminho este
-- cliente específico usou"). `both` nunca é um order_source válido — um
-- pedido sempre nasce de exatamente um caminho.
alter table public.orders
  add column order_source text not null default 'vexo_checkout',
  add column payment_channel text not null default 'gateway';

alter table public.orders
  add constraint orders_order_source_check check (order_source in ('vexo_checkout', 'whatsapp'));
alter table public.orders
  add constraint orders_payment_channel_check check (payment_channel in ('gateway', 'external'));

-- payment_status ganha um 6º valor, EXTERNAL — nunca "PENDING" para
-- representar pagamento combinado fora da VEXO (auditoria D2-A §3:
-- misturaria com "aguardando o Mercado Pago" em qualquer relatório futuro
-- que filtre só por payment_status). EXTERNAL é terminal: gravado uma
-- única vez na criação (create_order_from_cart, migration 20260817220081),
-- nunca transicionado depois — apply_payment_update (Etapa 11,
-- service_role/webhook) nunca vê essas linhas, porque nenhuma linha em
-- payments chega a existir para elas (create_payment_for_order nunca é
-- chamada no caminho WhatsApp).
alter table public.orders drop constraint orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'EXTERNAL'));

-- Amarra os dois campos no nível do banco, não só por convenção de
-- código: nunca EXTERNAL fora do canal external, nunca o canal external
-- com qualquer outro valor de payment_status.
alter table public.orders add constraint orders_payment_channel_status_consistency check (
  (payment_channel = 'external' and payment_status = 'EXTERNAL')
  or (payment_channel = 'gateway' and payment_status <> 'EXTERNAL')
);

create index orders_tenant_source_idx on public.orders (tenant_id, order_source);

comment on column public.orders.order_source is
  'Fluxo de UI que criou o pedido: vexo_checkout (checkout pago dentro da VEXO) ou whatsapp (pedido enviado ao WhatsApp da loja, Fase D2). Nunca ''both'' — isso é uma configuração da loja (tenants.checkout_mode), não um fato do pedido. Default ''vexo_checkout'' é a verdade literal de todo pedido já existente.';
comment on column public.orders.payment_channel is
  'gateway = pagamento rastreado pelo Mercado Pago (payment_status é a autoridade real, atualizado só pelo webhook); external = pagamento combinado fora da VEXO (payment_status fixo em EXTERNAL, nunca transicionado). Ver constraint orders_payment_channel_status_consistency.';

-- Nenhuma policy nova: SELECT de staff (orders.view, Etapa 10) e escrita
-- só via RPC SECURITY DEFINER já cobrem as colunas novas da mesma linha —
-- RLS protege linha, não coluna, mesmo raciocínio já registrado em
-- tenant_appearance_fields (20260817220075) / tenant_checkout_mode
-- (20260817220078). Nenhuma policy de `anon` toca `orders` diretamente
-- hoje, e esta migration não muda isso.
