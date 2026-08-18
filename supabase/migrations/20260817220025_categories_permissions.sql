-- Etapa 7 — permissões de categorias (prompt Etapa 7 §9).
--
-- Não existia `categories.*` na Etapa 2 (só `products.*`). Estendida com
-- exatamente a mesma matriz de papéis que `products.*` já tem — OWNER/
-- ADMIN/MANAGER com CRUD completo, OPERATOR/SUPPORT sem nenhum acesso —
-- porque categorias fazem parte do mesmo domínio de "gestão de catálogo"
-- que a Etapa 2 já delegou a esses três papéis via `products.*`. Não é
-- uma permissão nova inventada: é a mesma fronteira de autoridade já
-- aprovada, aplicada ao recurso irmão.
insert into public.permissions (key, group_name, description) values
  ('categories.view', 'categories', 'Ver categorias'),
  ('categories.create', 'categories', 'Criar categorias'),
  ('categories.update', 'categories', 'Editar categorias'),
  ('categories.delete', 'categories', 'Excluir categorias');

with role_perm (role_key, permission_key) as (
  values
    ('OWNER', 'categories.view'), ('OWNER', 'categories.create'),
    ('OWNER', 'categories.update'), ('OWNER', 'categories.delete'),
    ('ADMIN', 'categories.view'), ('ADMIN', 'categories.create'),
    ('ADMIN', 'categories.update'), ('ADMIN', 'categories.delete'),
    ('MANAGER', 'categories.view'), ('MANAGER', 'categories.create'),
    ('MANAGER', 'categories.update'), ('MANAGER', 'categories.delete')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_perm rp
join public.roles r on r.key = rp.role_key
join public.permissions p on p.key = rp.permission_key;
