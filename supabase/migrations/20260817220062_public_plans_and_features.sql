-- Etapa 14 (ajuste arquitetural) — leitura pública (anon) de planos e
-- recursos ATIVOS: preparação explícita para o futuro índice comercial
-- da VEXO (`/`), que deverá montar a seção de planos a partir destes
-- mesmos dados cadastrados pelo MASTER, nunca uma lista de preços
-- duplicada/hardcoded na página. Esta migration NÃO cria a página — só
-- garante que a RLS já está pronta para quando ela existir, sem exigir
-- alteração de RLS numa etapa futura.
--
-- Mesmo princípio de menor privilégio já usado para products/categories
-- (Etapa 7): só o que já é visível a `authenticated` (is_active = true)
-- passa a valer também para `anon` — nunca um plano/recurso rascunho,
-- nunca preço não publicado. `plan_features` segue pareado com a
-- visibilidade do plano (mesma regra já aplicada a `authenticated` na
-- migration 20260817220053).
--
-- plan_limits NÃO ganha policy de leitura pública aqui — permanece
-- exclusivo do MASTER (instrução explícita: "acesso somente pelo
-- MASTER"), nunca dado exibido no índice comercial.
create policy "anon can view active plans"
  on public.plans for select
  to anon
  using (is_active);

create policy "anon can view active features"
  on public.features for select
  to anon
  using (is_active);

create policy "anon can view plan_features of active plans"
  on public.plan_features for select
  to anon
  using (exists (select 1 from public.plans p where p.id = plan_id and p.is_active));
