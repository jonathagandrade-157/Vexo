"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { confirmProductImageUploadAction, prepareProductImageUploadAction, removeProductImageAction } from "@/features/products/actions";
import { resolveProductImagePreview } from "@/features/products/image-storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** D11.8 — bytes suficientes para `sniffImageMime` reconhecer qualquer uma das 3 assinaturas reais (WebP, a maior, usa os primeiros 12). Só este prefixo é enviado a `prepareProductImageUploadAction` — o arquivo inteiro nunca atravessa a Server Action. */
const MIME_SNIFF_PREFIX_BYTES = 32;

function UploadStatus({ pending }: { pending: boolean }) {
  if (!pending) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
      <span className="material-symbols-outlined animate-spin text-3xl text-on-surface">progress_activity</span>
    </div>
  );
}

/** Desabilita o input durante o envio — segunda camada de proteção contra duplo upload (prompt Etapa 8 §10/§17), além do próprio estado local já serializar o envio (D11.8: `pending` vem de `isUploading`, estado local do componente pai — nunca `useFormStatus`/`useActionState`, este componente não usa `<form>`, ver `ProductImageUploader`). */
function FileInputLabel({
  savedPath,
  onFileChange,
  pending,
}: {
  savedPath: string | null;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  pending: boolean;
}) {
  return (
    <label
      className={
        pending
          ? "cursor-not-allowed rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant opacity-50"
          : "cursor-pointer rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary/50 hover:text-on-surface"
      }
    >
      {savedPath ? "Substituir imagem" : "Enviar imagem"}
      <input
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={pending}
        name="file"
        onChange={onFileChange}
        type="file"
      />
    </label>
  );
}

/**
 * Só disponível na edição (produto já existe — precisa de um id real
 * para compor o path do Storage, arquitetura §9.2). Seleção de arquivo
 * dispara o envio automaticamente (sem clique extra).
 *
 * D11.8 — upload direto ao Supabase Storage (signed upload URL), não mais
 * através do body da Server Action: (1) `prepareProductImageUploadAction`
 * recebe só um prefixo de bytes do arquivo + o tamanho declarado, valida,
 * monta o path no servidor e devolve uma signed upload URL; (2) o próprio
 * navegador chama `uploadToSignedUrl` (via `createSupabaseBrowserClient`,
 * só a chave `anon`, sujeito à mesma RLS) direto contra o Storage — o
 * arquivo inteiro nunca passa por este processo Next.js/Vercel; (3)
 * `confirmProductImageUploadAction` revalida posse/permissão, confirma
 * que o objeto existe de fato no Storage e só então grava
 * `products.main_image`. Sem `useActionState` aqui: não é um único
 * dispatch, é uma sequência de 3 chamadas assíncronas orquestradas em
 * `handleFileChange`, com pending/erro controlados por estado local.
 *
 * D11.7 — causa raiz confirmada: este componente é renderizado dentro da
 * seção "Mídia" de `ProductForm`, que por sua vez já é um `<form>` inteiro
 * (nome/preço/categoria etc.). Antes, este componente também renderizava
 * seu próprio `<form>` — HTML inválido (form dentro de form), que o
 * navegador corrige silenciosamente ao fazer o parsing, descartando a tag
 * `<form>` interna e deixando o `<input type="file">` como filho do form
 * EXTERNO. Resultado: `formRef.current?.requestSubmit()` nunca disparava
 * `uploadProductImageAction` de verdade — na prática submetia (ou tentava
 * submeter) o form de produto, explicando por que nenhum upload de imagem
 * de produto jamais chegou ao Storage em produção. `LogoUploader`/
 * `BannerFormDialog` nunca tiveram esse problema por não estarem
 * aninhados dentro de outro `<form>`.
 *
 * Correção: elimina o `<form>` deste componente por completo (nunca foi
 * necessário — o envio sempre foi automático via JS, nunca dependeu de
 * submit nativo/Enter/validação de browser) em vez de tentar reposicionar
 * este componente para fora do form externo, o que quebraria o grid da
 * seção Mídia (itens de CSS Grid precisam ser filhos diretos do
 * container). `isPending`/status do upload agora vêm de estado local
 * (`useState`), não de `useFormStatus()`/`useActionState` — este
 * componente não usa `<form>` nem um dispatch único (ver D11.8 acima).
 */
export function ProductImageUploader({
  productId,
  initialImagePath,
}: {
  productId: string;
  initialImagePath: string | null;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "error" | "success">("idle");
  const [uploadMessage, setUploadMessage] = useState<string | undefined>(undefined);
  const [uploadedPath, setUploadedPath] = useState<string | null | undefined>(undefined);

  // D11.2 — cria E destrói a Object URL dentro do MESMO efeito (em vez de
  // criar no handler e só destruir no cleanup, como antes). Isso é o que
  // torna o preview resiliente ao duplo-invoke de efeitos do React Strict
  // Mode em `next dev` (`reactStrictMode: true`, next.config.ts): naquele
  // ciclo o React roda montagem→limpeza→montagem de novo logo após a
  // seleção do arquivo; com criação e destruição simétricas no mesmo
  // efeito, a segunda montagem gera uma Object URL nova e válida em vez de
  // deixar o preview apontando para uma URL já revogada (D11.1 §N —
  // hipótese PROVÁVEL, não confirmada por observação em navegador; este
  // fix não depende de essa ser a única causa, só remove a corrida em si).
  // `setPreviewUrl` aqui sincroniza React com um recurso de fato externo
  // (o registro de Blob URLs do navegador, criado e revogado neste mesmo
  // efeito) — não é o anti-padrão de "espelhar" um valor já derivável
  // durante o render que a regra abaixo normalmente pega.
  useEffect(() => {
    if (!selectedFile) return;
    const objectUrl = URL.createObjectURL(selectedFile);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza React com a Blob URL recém-criada (recurso externo do navegador), revogada no cleanup logo abaixo; ver comentário do efeito acima.
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  // Depois de um upload confirmado com sucesso, a URL real do Storage passa
  // a ser a fonte de verdade (resolveProductImagePreview abaixo já prioriza
  // `savedUrl` nesse caso) — o preview local deixa de ser necessário e é
  // liberado aqui, o que também dispara a revogação da Object URL no
  // cleanup do efeito acima. Erro NÃO limpa o preview: o arquivo
  // selecionado continua visível junto da mensagem de erro (§3 do prompt).
  useEffect(() => {
    if (uploadStatus !== "success") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reage a uma resposta assíncrona do servidor (confirmProductImageUploadAction), não a um valor já calculável durante o render; libera o preview local agora que a URL do Storage é a fonte de verdade.
    setSelectedFile(null);
  }, [uploadStatus]);

  const { savedPath, displayUrl, isBlobPreview } = resolveProductImagePreview({
    actionStatus: uploadStatus,
    actionImagePath: uploadStatus === "success" ? uploadedPath : undefined,
    initialImagePath,
    previewUrl,
  });

  /**
   * D11.8 — pipeline de upload direto: (1) só um prefixo de bytes +
   * tamanho vão para `prepareProductImageUploadAction`; (2) o arquivo
   * inteiro sobe direto ao Storage via `uploadToSignedUrl`, sem passar
   * por este processo Next.js; (3) `confirmProductImageUploadAction`
   * revalida tudo no servidor antes de gravar `products.main_image`. Erro
   * em qualquer passo NÃO limpa o preview local (arquivo selecionado
   * continua visível junto da mensagem de erro, mesmo comportamento de
   * sempre).
   */
  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setUploadStatus("idle");
    setUploadMessage(undefined);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.set("size", String(file.size));
      formData.set("header", file.slice(0, MIME_SNIFF_PREFIX_BYTES));

      const prepared = await prepareProductImageUploadAction(productId, formData);
      if (prepared.status !== "success" || !prepared.upload) {
        setUploadStatus("error");
        setUploadMessage(prepared.message ?? "Não foi possível preparar o upload.");
        return;
      }

      const { token, path, bucket, contentType } = prepared.upload;
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(path, token, file, { contentType });
      if (uploadError) {
        setUploadStatus("error");
        setUploadMessage("Não foi possível enviar a imagem. Tente novamente.");
        return;
      }

      const confirmed = await confirmProductImageUploadAction(productId, path);
      if (confirmed.status !== "success") {
        setUploadStatus("error");
        setUploadMessage(confirmed.message ?? "Não foi possível salvar a imagem no produto.");
        return;
      }

      setUploadStatus("success");
      setUploadedPath(confirmed.imagePath ?? null);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRemove() {
    setRemoveError(null);
    const result = await removeProductImageAction(productId);
    if (result.status === "error") {
      setRemoveError(result.message ?? "Não foi possível remover a imagem.");
    }
    return result;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full max-w-[220px] overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest">
        {displayUrl ? (
          <Image alt="" className="object-cover" fill sizes="220px" src={displayUrl} unoptimized={isBlobPreview} />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-outline">image</span>
          </div>
        )}
        <UploadStatus pending={isUploading} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FileInputLabel onFileChange={handleFileChange} pending={isUploading} savedPath={savedPath} />
        {savedPath ? (
          <ConfirmDialog
            confirmLabel="Remover"
            description="Tem certeza que deseja remover a imagem deste produto?"
            onConfirm={handleRemove}
            title="Remover imagem"
            trigger={
              <span className="font-label text-label-sm text-error transition-opacity hover:opacity-80">Remover</span>
            }
          />
        ) : null}
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">JPEG, PNG ou WebP — até 5MB.</p>

      {uploadStatus === "error" ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {uploadMessage}
        </p>
      ) : null}
      {removeError ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {removeError}
        </p>
      ) : null}
    </div>
  );
}
