# Etapa 4 — Onboarding e Configuração Inicial da Loja

> Documentação curta desta etapa. Para o desenho completo ver
> `docs/architecture/vexo-arquitetura-tecnica.md` (§6, §25) e
> `docs/architecture/etapa-3-auth-trial.md` (fluxo anterior, sem alterações
> de comportamento nesta etapa).

## Fluxo completo

```
/trial/sucesso  (Etapa 3, só o link do CTA mudou)
  → clique em "Configurar minha loja" → /onboarding

/onboarding  (Server Component)
  → sem sessão → /login
  → sem tenant OWNER pendente:
       - existe tenant OWNER já concluído → /painel
       - nenhum tenant OWNER (nem pendente nem concluído) → /  (ver "Loop de redirect" abaixo)
  → com tenant pendente → formulário (onboarding_sobre_sua_marca, "Etapa 1 de 8")
       → Server Action valida (Zod) → UPDATE tenants (nome, segmento,
         descrição, instagram, whatsapp, e-mail, onboarding_completed_at)
       → /painel

/painel  (Server Component, placeholder mínimo)
  → sem sessão → /login
  → tenant OWNER pendente → /onboarding (gate, mesmo fora do fluxo normal)
  → nenhum tenant nenhum → /onboarding (que por sua vez decide o destino final)
  → tenant concluído → placeholder "bem-vindo ao painel"
```

## Telas do Stitch usadas e não usadas

Só **`onboarding_sobre_sua_marca`** foi implementada — é o único passo de
dados desta etapa ("dados básicos da loja", nada além disso). As outras 13
telas `onboarding_*` do Stitch foram lidas e descartadas, todas por
dependerem de funcionalidade explicitamente fora do escopo desta etapa
(produtos, pagamento, frete, domínio, tema/identidade visual completa,
publicação) — ver a lista completa e o motivo de cada uma no plano
apresentado antes da implementação (histórico da conversa).

Uma decisão que vale registrar aqui: `onboarding_boas_vindas` e
`onboarding_escolha_de_plano_trial` (duas telas quase idênticas, ambas só
"inicie seu teste de 30 dias") **não** foram implementadas como uma
segunda tela antes do formulário. `/trial/sucesso` (Etapa 3) já cumpre
esse papel — inclusive já tinha um botão "Configurar minha loja" cujo
comentário no código dizia explicitamente que apontaria para o onboarding
assim que ele existisse. Reaproveitar aquelas duas telas exigiria um
segundo "iniciar trial", o que colide com a regra de um trial por tenant
(Etapa 3). Não é uma tela nova inventada — é reaproveitar a que já existe.

## Dados coletados (tenants)

Colunas novas em `tenants` (migration `20260817220018`), não uma tabela
separada — são todas escalares 1:1 com o tenant, exatamente os campos do
formulário do Stitch:

| Coluna | Obrigatório | Regra |
|---|---|---|
| `name` (já existia) | sim | reaproveitado — o campo "Nome da loja" edita o mesmo `tenants.name` da Etapa 3 |
| `segment` | sim | `CHECK` nos 5 valores do `<select>` do Stitch |
| `description` | não (único opcional na tela) | `CHECK` ≤ 500 caracteres |
| `instagram_handle` | sim | sem `@` (normalizado no schema Zod) |
| `whatsapp_phone` | sim | ≥ 10 dígitos, mesma regra do telefone da Etapa 3 |
| `contact_email` | sim | formato de e-mail válido |
| `onboarding_completed_at` | — | `NULL` = pendente; preenchido = concluído. Único mecanismo de conclusão. |

`slug` **não é tocado** por esta etapa — a tela do Stitch não tem campo de
slug, então não há o que editar aqui. As proteções de slug da Etapa 2
(`tenants_slug_format`, unicidade) continuam intactas e foram
re-verificadas por teste nesta etapa, não removidas nem contornadas.

## Conclusão do onboarding e gate do painel

`onboarding_completed_at` é a única fonte de verdade, gravada por um
`UPDATE` server-side. Nada em localStorage/sessionStorage/cookie/estado
React decide isso — tanto `/onboarding` quanto `/painel` reconsultam essa
coluna a cada request, direto no servidor.

O `UPDATE` roda no cliente Supabase **ligado à sessão** (não
`service_role`) — a policy de RLS já existente (`settings.update`, Etapa
2) continua sendo a autoridade final. O tenant a atualizar é resolvido
**inteiramente a partir da sessão** (`auth.uid()` + `tenant_members`, em
`features/onboarding/resolve-tenant.ts`), nunca de um campo do formulário
— não há onde um client malicioso colocaria um `tenant_id` de outra loja
para começar (testado: ver "IDOR / tenant hopping" abaixo).

## Auditoria

Reaproveita o mesmo `private.log_audit()`/trigger da Etapa 2 — sem segundo
sistema de log. `private.audit_tenant_changes()` (migration `20260817220019`)
ganhou mais um `elsif`: dispara `TENANT_ONBOARDING_COMPLETED` só na
transição `onboarding_completed_at` `null → not null`. Reenviar o
formulário depois de já concluído (double submit, ou reabrir a aba) grava
o mesmo `UPDATE` mas não duplica essa entrada, porque na segunda vez
`old.onboarding_completed_at` já não é mais `null`.

## Loop de redirect entre /onboarding e /painel (encontrado e corrigido)

Achado durante a revisão de segurança desta etapa, antes de considerá-la
concluída (mesmo padrão já estabelecido nas Etapas 2/3: não documentar um
problema real sem corrigir):

Um usuário autenticado **sem tenant nenhum** — cenário já documentado como
risco aceito na Etapa 3 ("uma conta Supabase Auth pode ficar sem
tenant/trial se um passo do cadastro falhar depois do `signUp()`") — caía
num loop infinito: `/onboarding` não achava tenant pendente e mandava para
`/painel`; `/painel` não achava tenant nenhum (pendente ou concluído) e
mandava de volta para `/onboarding`. Corrigido em `app/onboarding/page.tsx`:
antes de redirecionar para `/painel`, checa se de fato existe um tenant já
concluído; se não existir nenhum dos dois, vai para `/` em vez de
`/painel`. Não é desta etapa consertar a causa raiz (conta sem tenant) —
só não travar quem cair nela.

## Componentes/telas criadas

`app/onboarding` (`onboarding_sobre_sua_marca`) + `app/painel` (placeholder
mínimo, sem tela correspondente no Stitch porque o painel administrativo
real é de etapa futura). Compartilhado:
`components/ui/{select-field,textarea-field}.tsx` (mesmo padrão visual de
`text-field.tsx`, reaproveitando a classe `.input-focus-glow` da Etapa 3 em
vez de duplicá-la sob o nome `.input-glow` que o CSS desta tela do Stitch
declara com o mesmo efeito visual).

## Limitações e decisões pendentes

- Testado contra Postgres real + stub (mesmo harness das Etapas 2/3), não
  contra Supabase real — validação contra Supabase real continua sendo
  requisito antes do deploy (mesma ressalva das etapas anteriores).
- O gate de redirect de `/onboarding`/`/painel` (Server Components) foi
  verificado por build + revisão de código, não por um teste E2E/HTTP —
  o harness de integração é só Postgres, sem servidor Next.js rodando;
  a lógica de resolução de tenant que alimenta esse gate (mesma função,
  `resolveOnboardingTenant`) é a mesma testada nos 15 cenários via SQL.
- Um usuário com múltiplos tenants como OWNER (não acontece no fluxo atual
  — Etapa 3 cria exatamente um por cadastro) resolve de forma
  determinística (o mais antigo pendente/concluído primeiro), documentado
  como limitação conhecida em `resolve-tenant.ts`, não resolvido "por
  completo" sem necessidade real ainda.

## Funcionalidades deliberadamente não implementadas

Produtos, categorias, estoque, clientes, pedidos, checkout, pagamentos/
gateways, frete, domínio personalizado, assinatura paga/cobrança, painel
MASTER, relatórios/analytics/pixels, IA, API pública, sistema completo de
personalização de temas (upload de logo, cores, estilo de loja — tela
`onboarding_identidade_visual`) — todas fora do escopo desta etapa por
instrução explícita, nenhuma foi tocada.
