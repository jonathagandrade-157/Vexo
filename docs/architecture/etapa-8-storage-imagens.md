# Etapa 8 — Imagens, Storage e Aprimoramento do Catálogo

> Documentação curta desta etapa. Para o desenho completo do Storage ver
> `docs/architecture/vexo-arquitetura-tecnica.md` §9 (bucket/path/validação
> de upload, já documentados ali antes desta etapa existir) e
> `docs/architecture/etapa-7-catalogo.md` (base sobre a qual esta etapa é
> construída — `products.main_image` já existia, nullable, "fundação
> apenas").

## Fluxo implementado

```
/painel/produtos/novo  → cria o produto → redireciona para
/painel/produtos/[id]/editar  → card "Mídia" com upload real
  → selecionar arquivo → preview local instantâneo → upload automático
    (sem clique extra) → validação real no servidor → Storage → 
    products.main_image atualizado → aparece no painel e no storefront
  → "Substituir imagem" / "Remover" reaproveitam o mesmo fluxo
```

**Upload só na edição, nunca na criação.** O path do Storage depende de
um `product_id` real (arquitetura §9.2), que só existe depois do
`INSERT`. Gerar um id antecipadamente para permitir upload durante a
criação criaria risco de arquivo órfão se o formulário fosse abandonado
sem salvar. Mudança mínima e suficiente: `createProductAction` passou a
redirecionar para a edição (antes ia para a lista) — o lojista cai
direto na tela onde a imagem pode ser adicionada, já com um id real.

**Sem galeria de múltiplas imagens.** O prompt desta etapa descreve o
fluxo inteiro no singular (selecionar/upload/associar/remover/substituir
**uma** imagem). A arquitetura de longo prazo (§5.2) até cita uma tabela
`product_images` para o futuro, mas não a atribui a esta etapa — decisão
registrada como pendente, não implementada agora (`products.main_image`
continua sendo o único campo).

## Campos e tabelas

Nenhum campo novo, nenhuma tabela nova. Reaproveita `products.main_image`
(texto = **path** do Storage, nunca URL completa) e `public.audit_logs`
(via trigger estendido). URL pública é computada sob demanda
(`getProductImagePublicUrl`), nunca duplicada em coluna — o bucket é
público, não precisa de round-trip para gerar a URL.

## Migrations (2, incrementais)

- `20260817220028_storage_product_media_bucket.sql`: cria o bucket
  `product-media` (público, limite 5MB, allow-list
  `image/jpeg`/`image/png`/`image/webp` — valores já documentados na
  arquitetura §9.1/§9.3, não inventados agora) e as policies de
  `storage.objects` (ver "Segurança" abaixo).
- `20260817220029_audit_product_image_events.sql`: estende
  `private.audit_product_changes()` (Etapa 7) com 3 ramos novos —
  `PRODUCT_IMAGE_UPLOADED`/`PRODUCT_IMAGE_UPDATED`/`PRODUCT_IMAGE_DELETED`,
  checados antes do `PRODUCT_UPDATED` genérico, do mesmo jeito que
  `PRODUCT_STATUS_CHANGED` já era.

## Bucket e políticas de Storage

Um bucket só, `product-media` — nome/path (`{tenant_id}/products/{product_id}/...`)
já definidos na arquitetura, reaproveitados. Público de leitura por
**design** (é vitrine do storefront/SEO — diferente da lição da Etapa 6,
que era sobre um vazamento acidental de dado *administrativo*; aqui a
publicidade é intencional e documentada, restrita a um bucket que só
contém imagem de produto):

| Operação | Regra |
|---|---|
| `SELECT` | público (`anon` e `authenticated`), sem checar permissão — o bucket inteiro é uma vitrine |
| `INSERT` | exige `products.create` OU `products.update` no tenant derivado do 1º segmento do path |
| `UPDATE` | exige `products.update` |
| `DELETE` | exige `products.delete` (mapeamento explícito do prompt §7) |

Tenant sempre derivado do path via `storage.foldername(name)` (mesma
função do Supabase real) + `private.has_permission()` já existente —
nunca um sistema de autorização paralelo, nunca `using (true)`.

Na prática, como o upload só acontece na tela de edição (produto já
existe), a Server Action sempre checa `products.update` — a policy de
`INSERT` também aceitar `products.create` é defesa em profundidade para
um fluxo de criação-com-imagem que pode existir numa etapa futura, sem
custo de segurança adicional hoje.

## Server Actions

`uploadProductImageAction(productId, prevState, formData)` e
`removeProductImageAction(productId)`, em `features/products/actions.ts`.
Ordem, igual a toda action do projeto: sessão → tenant → membership →
`has_permission` → produto pertence ao tenant (busca escopada,
`resolveOwnedProduct`) → validação do arquivo → Storage (client de
sessão, **nunca `service_role`**) → `products.main_image` atualizado só
depois do upload confirmado → RLS como segunda camada real.

**Ordem de escrita pensada para nunca deixar um produto "quebrado"**: o
arquivo novo é enviado primeiro; só depois de confirmado é que
`main_image` passa a apontar para ele; o objeto antigo (se a extensão
mudou) só é removido por último, depois de tudo confirmado. Se qualquer
passo falhar no meio do caminho, o pior caso é um arquivo órfão
remanescente no Storage — nunca uma imagem quebrada visível ao lojista.
Se o `UPDATE` no banco falhar depois do upload ter sido bem-sucedido, o
arquivo recém-enviado é removido (rollback).

## Componentes React

`components/painel/product-image-uploader.tsx` (novo) — preview local
instantâneo (`URL.createObjectURL`, revogado via `useEffect` cleanup,
nunca `setState` dentro do próprio efeito — regra de pureza do
react-compiler já vista em etapas anteriores), loading (`useFormStatus`),
erro, sucesso, "Remover" (reaproveita `ConfirmDialog` da Etapa 7),
"Substituir", input desabilitado durante o envio. Integrado só em
`product-form.tsx` na edição — na criação mostra uma mensagem explicando
por quê. `StorefrontProductCard`, a página de produto do storefront e a
listagem/edição do painel passam a renderizar `next/image` quando
`main_image` existe, mantendo o ícone-placeholder atual como fallback
(nunca imagem fictícia).

## Validação do arquivo

Allow-list fechada de 3 formatos (`image/jpeg`, `image/png`,
`image/webp`) checada pelos **bytes mágicos reais** do arquivo
(assinatura JPEG/PNG/RIFF+WEBP) — nunca o `Content-Type` declarado pelo
browser nem a extensão do nome do arquivo. SVG nunca entra na allow-list
(vetor clássico de XSS armazenado). Limite de 5MB (valor já documentado
na arquitetura §9.3), checado no servidor **antes** de ler o arquivo
inteiro em memória. Nome do objeto sempre `main.{extensão real}`, gerado
100% no servidor — nunca o nome enviado pelo cliente.

## Segurança

Revisão explícita contra os 19 itens do checklist do prompt (§19):

- **Tenant hopping / IDOR / cross-tenant**: path sempre construído a
  partir do tenant resolvido por sessão (nunca aceito do cliente);
  `resolveOwnedProduct` reconfirma que o produto pertence ao tenant antes
  de tocar o Storage; testado explicitamente (tenant A não insere/atualiza/
  exclui objeto de tenant B).
- **Privilege escalation / autorização só no frontend**: toda checagem
  roda no servidor (`has_permission` + RLS de `storage.objects` como
  segunda camada real, testada via SQL) — o `accept` do `<input>` é só
  uma dica de UI, nunca a validação de verdade.
- **Path traversal**: nome do objeto nunca vem do cliente (`main.{ext}`
  fixo, gerado no servidor); mesmo assim, um path malformado/manipulado
  (ex.: `../{tenant}/...`) é testado e rejeitado com segurança pela
  policy (o cast do segmento inválido para `uuid` falha, a escrita nunca
  é aceita silenciosamente).
- **MIME spoofing / upload malicioso**: bytes mágicos reais, nunca o
  declarado; SVG/HTML/executável renomeado é rejeitado nos testes
  unitários dedicados.
- **`service_role` exposto / secret no frontend**: grep dedicado
  confirmou zero uso de `service_role`/`dangerouslySetInnerHTML` em todo
  o código novo — upload usa o client de sessão normal.
- **URLs privadas**: não aplicável — o bucket inteiro é público por
  design (não há URL "privada" de `product-media` para vazar).
- **Race condition / double submit**: input desabilitado durante o envio
  (client); pior caso no servidor é "última escrita vence" — não há
  contagem/unicidade envolvida (diferente do slug), então não corrompe
  estado.
- **Orphan files**: mitigado por design (ver "Server Actions" acima) —
  upload-antes-de-apontar, remoção do antigo só depois de confirmado,
  rollback se o `UPDATE` falhar depois do upload.

Nenhuma vulnerabilidade encontrada exigiu correção depois de escrita — a
única correção feita durante a própria implementação (antes de considerar
a etapa concluída, não depois) foi reordenar upload→apontar→limpar no
lugar de apontar→limpar→upload, especificamente para eliminar o cenário
"produto aponta para um arquivo que nunca chegou a existir".

## Sem pipeline de reprocessamento de imagem — limitação documentada

A arquitetura (§9.3) descreve um pipeline de resize/transcodificação
antes de persistir, para neutralizar *polyglot files*. Não implementado
nesta etapa — exigiria `sharp` (binário nativo), risco de build neste
ambiente sandboxed. Mitigação parcial, documentada como tal (não
apresentada como equivalente): allow-list fechada + sniff de bytes
mágicos reais + nome sempre gerado no servidor + `Content-Type` sempre o
real na hora de servir. Decisão pendente para quando `sharp`/Supabase
Image Transformation puderem ser validados de verdade.

## Integração com o storefront e painel

`getStorefrontProducts`/`getStorefrontProduct` (Etapa 7) já projetavam
`main_image` — nenhuma mudança de query foi necessária, só a renderização
(ícone-placeholder → `next/image` real quando o path existe).
`next.config.ts` ganhou `images.remotePatterns` restrito a hosts Supabase
(`**.supabase.co` hospedado, `127.0.0.1`/`localhost:54321` local) — nunca
um hostname arbitrário.

## Testes

`tests/unit/product-image-storage.test.ts` (9 testes) — sniff de bytes
mágicos reais (aceita JPEG/PNG/WebP, rejeita SVG/HTML/bytes aleatórios/
buffer vazio/RIFF-não-WEBP), construção determinística do path, URL
pública. `tests/integration/product-images.test.ts` (9 testes) — RLS de
`storage.objects` contra as **mesmas policies que valerão em produção**
(schema `storage` simplificado adicionado ao stub de teste, do mesmo
jeito que o schema `auth` já era desde a Etapa 2): tenant correto insere,
anon/outsider/sem-permissão são bloqueados, tenant A não escreve no path
de tenant B, path malformado é rejeitado, leitura é pública por design,
bucket tem exatamente a configuração documentada, e a auditoria registra
os 3 eventos de imagem corretamente (nunca como `PRODUCT_UPDATED`
genérico).

**Total da suíte: 142/142 testes passando** (120 da Etapa 7 + 9 unitários
+ 9 de integração de imagem, novos).

## O que foi validado no Supabase real — e o que não foi

Nada foi validado contra Supabase Storage real: o Docker deste sandbox
tem o binário do CLI mas **não tem o daemon rodando**
(`/var/run/docker.sock` não existe) — `supabase start` falha de forma
confirmada, não presumida, neste ambiente. Validado de fato:

- **Lógica de validação de arquivo** (sniff de bytes mágicos, limite de
  tamanho, path determinístico): testes unitários, sem rede — reais e
  passando.
- **RLS de `storage.objects`** (isolamento de tenant, permissão por
  operação): testada via SQL contra Postgres real com o schema `storage`
  simplificado — são as MESMAS policies que rodarão em produção,
  validadas na camada de banco.
- **Wiring de leitura** (`main_image` → URL pública → `next/image`):
  validado por `npm run build` (compila, gera as 21 rotas) e revisão de
  código — não por um upload real seguido de carregamento real da
  imagem no navegador.

Não validado (e não afirmado como validado): upload real de bytes contra
um bucket real, leitura HTTP real de uma imagem publicada, comportamento
real do `contentType`/`upsert` da Storage API, e o pipeline de
reprocessamento de imagem (não implementado). Passos necessários para
validar de verdade: `supabase start` funcionando (ou um projeto Supabase
hospedado de teste), aplicar as migrations, rodar a aplicação apontando
para ele, e testar manualmente upload/substituição/remoção pelo painel.

## Decisões pendentes

- Pipeline de reprocessamento de imagem (`sharp`/Supabase Image
  Transformation) — aguardando poder ser adicionado e validado sem risco
  de build neste ambiente.
- Antivírus/malware scan — já registrado como pendente na arquitetura
  (§9.3), não crítico para `product-media` dado o sniff de bytes mágicos.
- Galeria de múltiplas imagens (`product_images`) — aguardando
  aprovação explícita numa etapa futura (ver "Fluxo implementado" acima).

## Funcionalidades deliberadamente não implementadas

Carrinho, wishlist, checkout, pedidos, clientes, pagamentos/gateways,
frete, cupons, avaliações, assinatura/cobrança, domínio personalizado,
painel MASTER, relatórios, Google Analytics, Meta Pixel, IA, API pública,
marketplace, variantes de produto, sistema completo de edição de tema —
todas fora do escopo por instrução explícita do prompt desta etapa.
