-- D18.4 (Fase 2) — índice de performance para `/painel/historico`
-- (auditoria D18.4 Fase 1 §9/§H, aprovada pela decisão do produto item 6).
--
-- A consulta real de `features/history/data.ts::listHistoryForTenant` é
-- sempre `WHERE tenant_id = X ORDER BY created_at DESC LIMIT/OFFSET` — os
-- 3 índices simples já existentes (`audit_logs_tenant_id_idx`,
-- `audit_logs_actor_user_id_idx`, `audit_logs_created_at_idx`, migration
-- 20260817220007) atendem essa consulta com um scan por `tenant_id` seguido
-- de ordenação em memória, ou um scan pelo índice de `created_at`
-- filtrando por `tenant_id` — nenhum dos dois plans usa um único index
-- scan já ordenado. Este índice composto resolve a consulta inteira num
-- único index scan, sem ordenação em memória e sem depender do tamanho da
-- tabela inteira — só do tamanho do histórico DAQUELE tenant.
--
-- Puramente aditivo: não substitui nem remove nenhum dos 3 índices
-- existentes (cada um continua útil para outras consultas — ex.:
-- `audit_logs_actor_user_id_idx` para `/master/auditoria`, que não filtra
-- por tenant). Não altera RLS, não altera `audit_logs` além deste índice,
-- não altera nenhum trigger/função existente.
create index audit_logs_tenant_id_created_at_idx
  on public.audit_logs (tenant_id, created_at desc);

comment on index public.audit_logs_tenant_id_created_at_idx is
  'D18.4 — suporta a consulta paginada de /painel/historico (WHERE tenant_id = X ORDER BY created_at DESC) com um único index scan ordenado.';
