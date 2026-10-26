-- Fase D1 — fundação do modelo de recebimento de pedidos (VEXO / WhatsApp
-- / ambos). Coluna nova em public.tenants, mesmo padrão já usado duas
-- vezes para configuração 1:1 sem histórico (tenant_brand_info, migration
-- 20260817220018; tenant_appearance_fields, migration 20260817220075):
-- "escalar 1:1 com o tenant, sem histórico, sem N:1, não justifica uma
-- tabela própria". checkout_mode é exatamente isso — um único valor por
-- loja, sem histórico de mudanças necessário nesta fase, sem nenhuma outra
-- coluna relacionada que justificasse agrupar numa tabela
-- `checkout_settings` separada (diferente de shipping_settings, que nasce
-- 1:1 mas sempre teve uma tabela irmã 1:N — shipping_methods — desde o
-- desenho original; não é o caso aqui).
--
-- NOT NULL DEFAULT 'vexo': toda loja existente ganha o valor 'vexo'
-- automaticamente ao aplicar esta migration — nenhuma loja quebra, o
-- comportamento continua idêntico ao atual (que sempre foi só o checkout
-- pago). Nenhum modo além de 'vexo' tem qualquer comportamento
-- implementado ainda — isso é WhatsApp (Fase D2) e o modo combinado.
alter table public.tenants
  add column checkout_mode text not null default 'vexo';

alter table public.tenants
  add constraint tenants_checkout_mode_check
    check (checkout_mode in ('vexo', 'whatsapp', 'both'));

comment on column public.tenants.checkout_mode is
  'Como a loja recebe pedidos: vexo (checkout pago dentro do VEXO, hoje o único com comportamento real), whatsapp (pedido enviado ao WhatsApp da loja, fluxo real fica para a Fase D2) ou both (os dois caminhos disponíveis ao cliente). Default ''vexo'' preserva o comportamento de toda loja existente. Fase D1 — só a configuração existe; nenhum comportamento novo de checkout foi implementado ainda.';

-- Nenhuma policy nova: a policy de UPDATE de tenants já existente
-- ("tenant staff with settings.update can update their tenant", migration
-- 20260817220012 — using/with check has_permission(id, 'settings.update')
-- or is_platform_admin()) já cobre qualquer coluna nova da mesma linha —
-- mesmo raciocínio já registrado em tenant_appearance_fields/
-- tenant_brand_info. RLS protege linha, não coluna. O trigger
-- prevent_unauthorized_tenant_status_change só protege `status`, que esta
-- migration não toca.
