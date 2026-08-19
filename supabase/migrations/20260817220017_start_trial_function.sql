-- Etapa 3 — public.start_trial_for_tenant() (arquitetura §13, §25.1).
--
-- Único caminho para: (a) checar elegibilidade de trial e (b) gravar
-- trial_eligibility + trial_records — atomicamente, na mesma transação,
-- para eliminar a janela de corrida em que dois cadastros com o mesmo
-- documento poderiam ambos passar pela checagem antes de qualquer um
-- gravar (a UNIQUE constraint em trial_eligibility.document_hash é a
-- garantia final mesmo assim, mas fazer a checagem e a escrita na mesma
-- função evita depender só disso). Levanta um erro com SQLSTATE 'VX001'
-- e mensagem 'TRIAL_ALREADY_USED' — a Server Action do cadastro
-- reconhece esse código especificamente para rotear para a tela de erro,
-- em vez de tratar como uma falha genérica.
--
-- POR QUE service_role, NÃO authenticated (correção durante a própria
-- Etapa 3 — registrada aqui em vez de silenciosamente "fazer certo desde
-- o início", porque o raciocínio importa para quem for tocar nesta função
-- depois): a primeira versão aceitava `p_document_hash` como parâmetro e
-- concedia EXECUTE a `authenticated`. Isso parecia seguro porque o hash
-- em si não revela o CPF/CNPJ — mas qualquer parâmetro de uma função
-- chamável por `authenticated` é, por definição, fornecido por quem
-- chama. Nada impedia alguém de pular o formulário/Server Action e
-- chamar esta função diretamente via RPC com uma string qualquer como
-- "hash" (não precisa nem ser um HMAC de verdade) — derrotando a regra de
-- "um trial por documento" por completo, já que bastaria nunca repetir a
-- mesma string forjada. `auth.uid()` não sofre desse problema (vem do JWT
-- verificado, o client não escolhe), mas um parâmetro de texto livre sim.
--
-- A correção: só `service_role` pode chamar esta função — nunca o
-- browser, só o código server-side da própria aplicação, que é o único
-- lugar que conhece TRIAL_HASH_SECRET e calcula o hash a partir do
-- documento de verdade recém-validado (mesmo padrão de
-- `create_order_from_cart` na arquitetura §3.4.1: dado sensível para
-- cálculo/decisão nunca é aceito de um parâmetro alcançável por
-- `authenticated`). Como não há JWT de usuário em uma chamada
-- service_role, `p_user_id` passa a ser explícito — mas só a Server
-- Action (que já validou a sessão via supabase.auth.getUser() antes de
-- montar essa chamada) decide esse valor; o browser nunca o escolhe.
create function public.start_trial_for_tenant(
  p_user_id uuid,
  p_tenant_id uuid,
  p_document_hash text
)
returns public.trial_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.trial_records;
begin
  if p_user_id is null then
    raise exception 'start_trial_for_tenant: user id required'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  -- Só quem criou o tenant pode iniciar o trial dele — nunca um tenant_id
  -- arbitrário. tenants.created_by só pode ter sido setado pelo próprio
  -- public.create_tenant() a partir do auth.uid() de quem chamou aquela
  -- função (0011), então esta checagem continua confiável mesmo vinda de
  -- um p_user_id explícito.
  if not exists (
    select 1 from public.tenants t
    where t.id = p_tenant_id and t.created_by = p_user_id
  ) then
    raise exception 'start_trial_for_tenant: caller did not create this tenant'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.trial_records tr where tr.tenant_id = p_tenant_id) then
    raise exception 'start_trial_for_tenant: this tenant already has a trial record'
      using errcode = '42501';
  end if;

  -- A checagem de elegibilidade real: um document_hash só pode iniciar um
  -- trial uma vez, em qualquer tenant.
  if exists (select 1 from public.trial_eligibility te where te.document_hash = p_document_hash) then
    raise exception 'TRIAL_ALREADY_USED'
      using errcode = 'VX001'; -- código próprio, reconhecido pela Server Action
  end if;

  insert into public.trial_eligibility (document_hash, first_tenant_id)
  values (p_document_hash, p_tenant_id);

  insert into public.trial_records (tenant_id, started_at, ends_at, status)
  values (p_tenant_id, now(), now() + interval '30 days', 'active')
  returning * into v_record;

  -- actor_type resolve para 'system' aqui (chamada via service_role, sem
  -- JWT de usuário para private.log_audit's auth.uid() ler) — aceito
  -- deliberadamente em vez de estender a assinatura de log_audit (Etapa 2)
  -- para aceitar um ator explícito: TRIAL_STARTED sendo atribuído ao
  -- "sistema" como parte do fluxo automatizado de cadastro é uma
  -- descrição razoável e honesta do que de fato aconteceu, e evita tocar
  -- em código já aprovado da Etapa 2 por uma melhoria de atribuição
  -- cosmética.
  perform private.log_audit(
    p_tenant_id, 'TRIAL_STARTED', 'trial_records', v_record.id::text,
    null, jsonb_build_object('ends_at', v_record.ends_at)
  );

  return v_record;
end;
$$;

comment on function public.start_trial_for_tenant(uuid, uuid, text) is
  'Único caminho para checar elegibilidade e iniciar um trial. service_role-only — ver comentário acima sobre por que authenticated não pode chamar isto diretamente. Levanta SQLSTATE VX001 (mensagem TRIAL_ALREADY_USED) quando o document_hash já foi usado — arquitetura §13.';

-- IMPORTANTE: "revoke ... from public" sozinho NÃO bastaria — PUBLIC é o
-- pseudo-papel que todo mundo herda por padrão, mas o Supabase concede
-- EXECUTE em toda função nova de `public` diretamente a anon/authenticated/
-- service_role via ALTER DEFAULT PRIVILEGES do próprio projeto (é assim
-- que RPCs "simplesmente funcionam" sem GRANT manual) — revogar só de
-- PUBLIC deixa esses três GRANTs diretos intactos. Por isso os três papéis
-- são nomeados explicitamente aqui, não apenas "public".
revoke execute on function public.start_trial_for_tenant(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_trial_for_tenant(uuid, uuid, text) to service_role;
