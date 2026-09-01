"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useActionState } from "react";

import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { removeProductImageAction, uploadProductImageAction } from "@/features/products/actions";
import { resolveProductImagePreview } from "@/features/products/image-storage";
import { initialProductImageState } from "@/features/products/schema";

function UploadStatus({ pending }: { pending: boolean }) {
  if (!pending) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
      <span className="material-symbols-outlined animate-spin text-3xl text-on-surface">progress_activity</span>
    </div>
  );
}

/** Desabilita o input durante o envio — segunda camada de proteção contra duplo upload (prompt Etapa 8 §10/§17), além do próprio estado local já servializar o envio (D11.7: `isPending` de `useActionState`, não mais `useFormStatus` — este componente não usa mais `<form>`, ver `ProductImageUploader`). */
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
 * dispara o envio automaticamente (sem clique extra), chamando
 * `uploadProductImageAction` (já vinculado ao productId via `.bind`, mesmo
 * padrão de Server Action parametrizada usado em `deleteProductAction
 * (productId)` em `ProductActions`) diretamente através do dispatch que
 * `useActionState` devolve, com um `FormData` montado manualmente.
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
 * container). `isPending` vem do 3º valor de `useActionState` (React 19)
 * em vez de `useFormStatus()`, que exige ancestralidade real de `<form>`.
 */
export function ProductImageUploader({
  productId,
  initialImagePath,
}: {
  productId: string;
  initialImagePath: string | null;
}) {
  const uploadAction = uploadProductImageAction.bind(null, productId);
  const [state, formAction, isPending] = useActionState(uploadAction, initialProductImageState);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

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
    if (state.status !== "success") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reage a uma resposta assíncrona do servidor (useActionState), não a um valor já calculável durante o render; libera o preview local agora que a URL do Storage é a fonte de verdade.
    setSelectedFile(null);
  }, [state]);

  const { savedPath, displayUrl, isBlobPreview } = resolveProductImagePreview({
    actionStatus: state.status,
    actionImagePath: state.status === "success" ? state.imagePath : undefined,
    initialImagePath,
    previewUrl,
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    // Sem <form> (ver comentário do componente acima) — o FormData é
    // montado aqui, com o mesmo shape que uploadProductImageAction já
    // espera (`formData.get("file")`), e despachado diretamente via o
    // dispatch que useActionState devolve (suportado chamar fora de um
    // envio de <form>, não só como prop `action`).
    const formData = new FormData();
    formData.set("file", file);
    formAction(formData);
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
        <UploadStatus pending={isPending} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FileInputLabel onFileChange={handleFileChange} pending={isPending} savedPath={savedPath} />
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

      {state.status === "error" ? (
        <p className="font-body text-body-sm text-error" role="alert">
          {state.message}
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
