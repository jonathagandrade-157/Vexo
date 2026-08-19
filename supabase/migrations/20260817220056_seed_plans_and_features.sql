-- Etapa 14 — seed inicial de planos e recursos (prompt §3/§5/§6: os
-- nomes/exemplos dados explicitamente no prompt, não valores inventados).
-- Preços ficam NULL (prompt §4) — o MASTER configura depois. Rodando como
-- o dono da migration (bypassa RLS naturalmente, mesmo padrão já usado
-- para semear roles/permissions na Etapa 2).
insert into public.plans (slug, name, description, trial_days, sort_order) values
  ('basic', 'Básico', 'Plano de entrada — o essencial para vender online.', 30, 0),
  ('intermediate', 'Intermediário', 'Para lojas em crescimento — cupons, estoque e relatórios.', 30, 1),
  ('pro', 'Pro', 'Plano completo — todos os recursos da VEXO.', 30, 2);

insert into public.features (key, name, description, category) values
  ('storefront', 'Loja online', 'Loja pública com storefront funcional.', 'catalog'),
  ('products', 'Produtos', 'Cadastro e gestão de produtos.', 'catalog'),
  ('categories', 'Categorias', 'Organização de produtos por categoria.', 'catalog'),
  ('orders', 'Pedidos', 'Checkout e gestão de pedidos.', 'catalog'),
  ('customers', 'Clientes', 'Cadastro e histórico de clientes.', 'catalog'),
  ('coupons', 'Cupons', 'Cupons e descontos promocionais.', 'marketing'),
  ('inventory', 'Estoque', 'Controle de estoque por produto.', 'catalog'),
  ('variants', 'Variantes', 'Variantes de produto (tamanho, cor, etc.).', 'catalog'),
  ('shipping', 'Frete', 'Cálculo de frete com preço fixo configurado pelo lojista.', 'shipping'),
  ('shipping_real', 'Frete com transportadora real', 'Cálculo de frete via Correios/Melhor Envio/outros.', 'shipping'),
  ('payment_mercadopago', 'Pagamento — Mercado Pago', 'Recebimento via Mercado Pago.', 'payments'),
  ('payment_pagbank', 'Pagamento — PagBank', 'Recebimento via PagBank.', 'payments'),
  ('payment_asaas', 'Pagamento — Asaas', 'Recebimento via Asaas.', 'payments'),
  ('payment_stripe', 'Pagamento — Stripe', 'Recebimento via Stripe.', 'payments'),
  ('basic_customization', 'Personalização básica', 'Ajustes básicos de identidade visual da loja.', 'customization'),
  ('advanced_customization', 'Personalização avançada', 'Controle avançado de identidade visual da loja.', 'customization'),
  ('themes', 'Temas', 'Múltiplos modelos/temas de loja.', 'customization'),
  ('custom_domain', 'Domínio próprio', 'Uso de domínio personalizado para a loja.', 'domain'),
  ('analytics', 'Analytics', 'Integração com ferramentas de analytics.', 'analytics'),
  ('advanced_analytics', 'Analytics avançado', 'Métricas avançadas de comportamento e conversão.', 'analytics'),
  ('reports', 'Relatórios', 'Relatórios de vendas e pedidos.', 'reports'),
  ('advanced_reports', 'Relatórios avançados', 'Relatórios avançados e exportáveis.', 'reports'),
  ('vexo_ai', 'Vexo AI', 'Recursos de inteligência artificial da VEXO.', 'ai'),
  ('api_access', 'Acesso à API', 'Integração via API pública da VEXO.', 'api'),
  ('multiple_images', 'Múltiplas imagens', 'Mais de uma imagem por produto.', 'catalog'),
  ('abandoned_cart', 'Carrinho abandonado', 'Recuperação de carrinhos abandonados.', 'marketing'),
  ('priority_support', 'Suporte prioritário', 'Atendimento prioritário da equipe VEXO.', 'support');

-- Associações exatas do exemplo do prompt §6 — BASIC e INTERMEDIATE
-- explicitamente listados; PRO recebe todos os recursos ("tudo do
-- intermediário... e etc.", prompt §6/§3: "Plano completo").
insert into public.plan_features (plan_id, feature_id)
select p.id, f.id
from public.plans p
join public.features f on f.key in ('storefront', 'products', 'categories', 'orders')
where p.slug = 'basic';

insert into public.plan_features (plan_id, feature_id)
select p.id, f.id
from public.plans p
join public.features f on f.key in ('storefront', 'products', 'categories', 'orders', 'coupons', 'inventory', 'shipping', 'reports')
where p.slug = 'intermediate';

insert into public.plan_features (plan_id, feature_id)
select p.id, f.id
from public.plans p
cross join public.features f
where p.slug = 'pro';
