-- Etapa 11 — permissões de pagamentos (prompt Etapa 11 §7). Não existia
-- nenhuma `payments.*` (confirmado por busca antes de criar). Conectar
-- uma conta financeira é mais sensível que só visualizar — por isso
-- `payments.manage` fica restrita a OWNER/ADMIN (não MANAGER, diferente
-- da maioria das matrizes `*.manage`/`*.update` deste projeto), enquanto
-- `payments.view` segue o padrão usual de OWNER/ADMIN/MANAGER.
insert into public.permissions (key, group_name, description) values
  ('payments.view', 'payments', 'Ver configuração de pagamentos'),
  ('payments.manage', 'payments', 'Conectar/desconectar gateway de pagamento');

with role_permission_pairs (role_key, permission_key) as (
  values
    ('OWNER', 'payments.view'), ('OWNER', 'payments.manage'),
    ('ADMIN', 'payments.view'), ('ADMIN', 'payments.manage'),
    ('MANAGER', 'payments.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_permission_pairs rp
join public.roles r on r.key = rp.role_key
join public.permissions p on p.key = rp.permission_key;
