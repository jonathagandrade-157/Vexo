# Confirmação de e-mail e recuperação — configuração do release

Revisão de código: `c9e525621ecb514df97b9736949c418e0a586e28`, PR #3.
Inspeção em 05/11/2026: Auth de produção permite cadastro/e-mail e está com
confirmação **desativada** (`mailer_autoconfirm=true`). Nenhuma configuração
Auth/SMTP foi alterada. A presença de RESEND_API_KEY no Vercel não comprova
SMTP do Supabase nem entrega de confirmação/recuperação.

## Comportamento implementado

- Com confirmação habilitada: cadastro aguarda o e-mail antes de enriquecer
  perfil/criar loja/trial. Dados de retomada ficam por até uma hora em cookie
  HttpOnly/Lax/Secure em HTTPS, cifrado/autenticado e vinculado ao usuário;
  sem senha ou CPF em claro. O hash de documento vem do servidor.
- `/auth/confirm` troca PKCE ou valida token_hash pelo Supabase; aceita tipos
  delimitados e ignora destinos arbitrários. Respostas usam no-store e
  no-referrer. Propósito de recovery não substitui validação pelo provedor.
- Link inválido, expirado ou reutilizado leva a mensagem genérica. Reenvio e
  recuperação não confirmam existência da conta nem exibem erro bruto.
- Em outro navegador, conta confirmada conclui os dados em formulário
  autenticado. Metadados editáveis do Auth não autorizam hash/trial.
- Falha após criar loja permite retomar o trial na mesma loja incompleta do
  OWNER, mantendo elegibilidade no RPC. O login consulta o estado no banco
  mesmo sem cookie; não depende de um parâmetro da URL para liberar retomada.
  Não criar uma segunda loja no retry.
- Recuperação estabelece sessão, altera somente a senha do usuário verificado
  e encerra a sessão. Links legados implícitos de convite continuam suportados;
  nenhum convite externo foi enviado nesta etapa.
- Com autoconfirmação, o fluxo imediato continua disponível. Sua existência
  não comprova confirmação de titularidade do e-mail.

## Configuração humana antes de ativar confirmação hospedada

1. Definir domínio/remetente real, operador e caixa sintética autorizada.
   Configurar o provedor SMTP em Supabase → Authentication → Email/SMTP;
   credenciais somente no painel/cofre. Validar domínio e limites do provedor.
2. No ambiente isolado, configurar Site URL e redirect allowlist para a URL
   HTTPS estável, com retorno `/auth/confirm`. Na aplicação,
   `NEXT_PUBLIC_SITE_URL` deve ser essa mesma origem; rebuildar se mudar.
   Produção possui esse nome configurado; seu valor não foi baixado.
3. Templates padrão com `{{ .ConfirmationURL }}` usam a verificação do
   Supabase e retornam ao `redirectTo` enviado pelo código. Se houver template
   próprio, revisar o link para não eliminar `/auth/confirm`, propósito e fluxo.
   Alternativa token_hash deve usar o tipo correto e passar pelo mesmo handler.
   Não apontar e-mails de homologação para produção.
4. Habilitar confirmação somente no ambiente aprovado e provar entrega real
   na caixa sintética autorizada, cadastro no mesmo navegador e em outro,
   expiração/reenvio, recuperação, reutilização negada e mensagens genéricas.
5. Registrar somente IDs, horários, commit/deployment e resultados. Nunca
   copiar URLs com code/token_hash, corpos de e-mail ou cabeçalhos de sessão
   para relatório, artefatos públicos ou logs. O mailbox local do CI é sintético.
6. Após aceite, incluir a mudança de Auth/SMTP no GO de produção e repetir
   o smoke aprovado. Não habilitar silenciosamente em produção.

## Evidência e limites

O CI usa stack Supabase local descartável com confirmação habilitada e
Mailpit, sem SMTP externo. As jornadas seguem o link efetivamente emitido,
envelhecem apenas o timestamp de contas sintéticas para provar expiração,
reenvio e recuperação PKCE, e verificam senha antiga negada/nova aceita.
A matriz roda em desktop, Pixel 7 emulado e 360 px. O resultado definitivo
fica em [RELEASE_READINESS.md](../RELEASE_READINESS.md), vinculado ao SHA.

Isso não homologa DNS, SMTP, reputação/entregabilidade nem configurações
de templates do projeto hospedado. Nenhum e-mail real foi disparado.

Referências: [Supabase SSR/PKCE](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[redirects](https://supabase.com/docs/guides/auth/redirect-urls).
