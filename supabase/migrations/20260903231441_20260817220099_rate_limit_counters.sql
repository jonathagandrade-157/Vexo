-- D15-S.2 — infraestrutura de rate limiting para endpoints públicos que
-- podem gerar chamadas externas/custo (app/api/shipping/quote,
-- app/api/address/cep).
--
-- POR QUE NÃO EM MEMÓRIA: o VEXO roda em Vercel/serverless — cada
-- invocação pode cair numa instância diferente (escalonamento automático
-- sob carga, distribuição geográfica entre regiões, cold start depois de
-- ociosidade), e não existe memória compartilhada entre elas. Um
-- `Map`/`Set`/contador em variável de módulo:
--   - não é visto por uma segunda instância concorrente (um atacante
--     mandando requisições em paralelo já contorna o limite só por
--     estatística de distribuição entre instâncias);
--   - zera a cada cold start/reinicialização (nenhuma persistência);
--   - não se aplica entre regiões diferentes;
--   - mesmo dentro de uma única instância, um incremento não-atômico
--     (`count++` fora de uma única operação síncrona sobre um dado já
--     lido) pode perder incrementos sob concorrência real.
-- Nenhuma dessas limitações é aceitável para um controle de segurança.
--
-- POR QUE POSTGRES (Supabase), NÃO Redis/Upstash/Vercel KV: o projeto já
-- tem Postgres como única fonte de verdade compartilhada entre todas as
-- instâncias/regiões (é a mesma infraestrutura que já garante
-- atomicidade para orders/payments/tenants neste projeto — ver
-- create_order_from_cart, update_order_status, update_tenant_status).
-- Usar o que já existe evita introduzir um serviço novo, uma credencial
-- nova, uma variável de ambiente nova — só uma tabela pequena e uma
-- function, no mesmo banco já configurado. Um `INSERT ... ON CONFLICT ...
-- DO UPDATE ... RETURNING` é atômico no Postgres — a linha é bloqueada
-- durante o UPDATE, então duas requisições concorrentes (de instâncias
-- serverless diferentes, regiões diferentes, não importa) nunca perdem um
-- incremento nem leem um valor desatualizado.
--
-- Janela fixa (fixed window), não sliding window/token bucket: mais
-- simples de implementar corretamente numa única instrução atômica, e
-- suficiente para o objetivo (impedir abuso automatizado/custo — não
-- precisa da suavidade de um token bucket para isso). `window_start` é o
-- timestamp truncado para múltiplos de `p_window_seconds` — todas as
-- requisições dentro da mesma janela compartilham a mesma linha.
create table public.rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (key, window_start)
);

comment on table public.rate_limit_counters is
  'D15-S.2 — contador de janela fixa para rate limiting de endpoints públicos (app/api/shipping/quote, app/api/address/cep). Nunca lido/escrito por anon/authenticated — só via public.check_rate_limit(), chamada pelo route handler com o client service-role (lib/security/rate-limit.ts). Linhas de janelas antigas são removidas oportunisticamente pela própria function a cada chamada (sem job/extensão nova).';

-- RLS habilitada e sem NENHUMA policy — mesmo padrão já usado neste
-- projeto para tabelas internas que só o service_role deve tocar
-- (payment_webhook_events, trial_eligibility, migration
-- 20260817220067_grant_base_table_privileges.sql): nega tudo a
-- anon/authenticated por padrão, sem precisar enumerar exceções.
alter table public.rate_limit_counters enable row level security;
alter table public.rate_limit_counters force row level security;

grant select, insert, update, delete on public.rate_limit_counters to service_role;

-- Incrementa (ou cria) o contador da janela atual para `p_key` de forma
-- atômica e devolve se ainda está dentro do limite, o valor atual, e
-- quantos segundos faltam para a janela virar (usado como `Retry-After`
-- pelo chamador). `security invoker` (padrão, não definer) — de
-- propósito: só é chamável por `service_role`, que já tem acesso direto à
-- tabela pelos GRANTs acima, então não há privilégio nenhum a elevar
-- (mesmo raciocínio de private.prevent_unauthorized_tenant_status_change,
-- migration 20260817220012: minimizar uso de SECURITY DEFINER,
-- arquitetura §14).
create function public.check_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (allowed boolean, current_count integer, retry_after_seconds integer)
language plpgsql
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_window_seconds <= 0 or p_max_requests <= 0 then
    raise exception 'check_rate_limit: p_window_seconds and p_max_requests must be positive' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_counters (key, window_start, request_count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start)
  do update set request_count = public.rate_limit_counters.request_count + 1
  returning public.rate_limit_counters.request_count into v_count;

  -- Limpeza oportunista: nunca deixa a tabela crescer sem limite, sem
  -- precisar de um job/extensão nova (pg_cron não está confirmado
  -- disponível neste projeto) — cada chamada já paga o custo de manter a
  -- tabela pequena, removendo janelas de mais de 1 hora atrás (bem além de
  -- qualquer p_window_seconds usado pelos chamadores atuais).
  delete from public.rate_limit_counters where window_start < clock_timestamp() - interval '1 hour';

  return query select
    v_count <= p_max_requests,
    v_count,
    greatest(0, ceil(extract(epoch from (v_window_start + (p_window_seconds || ' seconds')::interval - clock_timestamp()))))::integer;
end;
$$;

comment on function public.check_rate_limit(text, integer, integer) is
  'D15-S.2 — incrementa atomicamente o contador da janela atual para p_key (INSERT ... ON CONFLICT ... DO UPDATE, atômico mesmo sob concorrência entre instâncias serverless diferentes) e devolve se ainda está dentro do limite. Chamada exclusivamente por lib/security/rate-limit.ts via client service-role.';

revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
