-- Fase D2-B (revisão final) — preferência de pagamento informativa do
-- fluxo WhatsApp. Decisão explícita desta revisão: seleção OBRIGATÓRIA,
-- só 3 valores fechados (pix/cash/card) — nunca "combinar com a
-- loja"/"outro"/texto livre. Nunca usada por nenhuma lógica financeira/
-- de autorização — só exibida na mensagem do WhatsApp
-- (lib/whatsapp/message.ts) e na tela de confirmação. Nunca altera
-- payment_status/payment_channel.
alter table public.orders
  add column requested_payment_method text;

alter table public.orders add constraint orders_requested_payment_method_check
  check (requested_payment_method is null or requested_payment_method in ('pix', 'cash', 'card'));

-- Equivalência nos DOIS sentidos (mais forte que a versão anterior desta
-- migration, que só impedia requested_payment_method num pedido gateway,
-- mas ainda permitia um external SEM preferência — a seleção agora é
-- obrigatória, então todo pedido external tem uma, e nenhum gateway tem):
-- um pedido gateway NUNCA carrega uma preferência (o Mercado Pago já
-- resolve o método de pagamento real do lado dele, em payments.method);
-- um pedido external SEMPRE carrega uma, porque o formulário do fluxo
-- WhatsApp exige a escolha antes de finalizar.
alter table public.orders add constraint orders_requested_payment_method_channel_check
  check ((payment_channel = 'external') = (requested_payment_method is not null));

-- Troco (só Dinheiro) — Fase D2-B (revisão final) §10/§11. NULL = cliente
-- paga o valor exato, sem troco (nunca confundido com "não informado":
-- o formulário sempre obriga a escolha "Precisa de troco? Não/Sim").
-- Preenchido = quanto o cliente vai pagar (nunca o troco em si, que é
-- sempre recalculado em runtime como cash_change_for - total — nunca
-- armazenado separadamente, para nunca divergir se o total mudar antes
-- da mensagem ser montada). A checagem de que cash_change_for cobre o
-- total real é feita no servidor ANTES de criar o pedido (nunca aqui —
-- o total final, com frete, só existe depois de apply_shipping_to_order);
-- esta CHECK é só uma segunda camada, contra o subtotal já conhecido no
-- momento da criação (nunca pode ser MENOR que o pedido custou até aqui).
alter table public.orders
  add column cash_change_for numeric(10, 2);

alter table public.orders add constraint orders_cash_change_for_method_check
  check (cash_change_for is null or requested_payment_method = 'cash');
alter table public.orders add constraint orders_cash_change_for_covers_subtotal_check
  check (cash_change_for is null or cash_change_for >= subtotal);

comment on column public.orders.requested_payment_method is
  'Preferência de pagamento OBRIGATÓRIA no fluxo WhatsApp (pix/cash/card) — nunca processada pela VEXO, nunca altera payment_status/payment_channel. NULL somente para pedidos payment_channel=gateway (ver orders_requested_payment_method_channel_check).';
comment on column public.orders.cash_change_for is
  'Só para requested_payment_method=cash — quanto o cliente vai pagar (nunca o troco em si, sempre recalculado como cash_change_for - total). NULL = sem troco, cliente paga o valor exato.';

-- Nenhuma policy nova, mesmo raciocínio das demais colunas desta fase.
