-- D3.2-B Ponto 2A-Implementação — peso e dimensões físicas de products,
-- preparando o banco para uma futura cotação de frete por transportadora
-- (Melhor Envio) — nenhuma cotação/chamada de API é implementada aqui,
-- só os quatro campos que a API exigiria (auditoria D3.2-B Ponto 2/2A).
--
-- Unidades fixadas pela própria convenção da API que os consumirá no
-- futuro (kg para peso, cm para dimensões) — evita qualquer conversão
-- entre "o que o VEXO guarda" e "o que a transportadora espera".
--
-- `numeric`, nunca `double precision` — mesmo motivo de `products.price`
-- (Etapa 7): valor de negócio que alimenta cálculo externo não pode ter
-- imprecisão de ponto flutuante binário. `numeric(8,3)` para peso (3
-- casas cobrem gramas), `numeric(8,2)` para as três dimensões (2 casas
-- cobrem milímetros) — folga de sobra acima de qualquer produto físico
-- real sem impor um teto arbitrário ainda não confirmado.
--
-- Todos os quatro campos nascem NULL, sem DEFAULT numérico — NULL é o
-- único "não preenchido" válido (nunca 0, que seria um peso/dimensão
-- fisicamente inválido e indistinguível de "não informado", mesmo
-- princípio já usado em products.promotional_price/category_id). Isso
-- significa que TODO produto existente continua válido e funcional sem
-- nenhum backfill: nenhum outro fluxo (catálogo, carrinho, checkout,
-- pedidos, flat_rate/pickup/own_delivery, PIX, Mercado Pago, WhatsApp) lê
-- estas colunas.
--
-- CHECK: quando preenchido, o valor deve ser estritamente positivo
-- (> 0) — zero e negativo são sempre inválidos para um peso/dimensão
-- físico real. Nenhum teto máximo é adicionado nesta migration (não
-- confirmado por nenhuma etapa anterior — decisão explícita da auditoria
-- 2A).
--
-- Escopo estritamente esta tabela: nenhuma alteração em RLS, policies,
-- grants, triggers existentes, outras tabelas, ou dados já existentes
-- (nenhum UPDATE/backfill).
alter table public.products
  add column weight numeric(8, 3),
  add column height numeric(8, 2),
  add column width numeric(8, 2),
  add column length numeric(8, 2);

alter table public.products
  add constraint products_weight_positive check (weight is null or weight > 0),
  add constraint products_height_positive check (height is null or height > 0),
  add constraint products_width_positive check (width is null or width > 0),
  add constraint products_length_positive check (length is null or length > 0);

comment on column public.products.weight is
  'Peso do produto em quilogramas (kg). NULL = não informado (produto continua válido em todo fluxo atual; só fica de fora de uma futura cotação por transportadora). Nunca 0 — check products_weight_positive exige > 0 quando preenchido.';
comment on column public.products.height is
  'Altura do produto em centímetros (cm). Mesma regra de NULL de weight — ver comentário da coluna weight.';
comment on column public.products.width is
  'Largura do produto em centímetros (cm). Mesma regra de NULL de weight — ver comentário da coluna weight.';
comment on column public.products.length is
  'Comprimento do produto em centímetros (cm). Mesma regra de NULL de weight — ver comentário da coluna weight.';
