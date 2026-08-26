"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { ColorInput } from "@/components/painel/color-input";
import { updateStoreAppearanceAction } from "@/features/settings/appearance-actions";
import { initialStoreAppearanceState, type StorefrontTemplate } from "@/features/settings/appearance-schema";
import { getTenantMediaPublicUrl } from "@/features/settings/logo-storage";
import { LogoUploader } from "./logo-uploader";
import { StorePreview } from "./store-preview";
import { TemplateSelector } from "./template-selector";

/**
 * Cores padrão exibidas quando o tenant ainda não personalizou nada
 * (`primary_color`/`secondary_color` NULL) — mesmo gradiente já usado em
 * `components/ui/submit-button.tsx`, então uma loja sem personalização
 * continua visualmente coerente com o resto do VEXO até o lojista mudar.
 * Salvar sem alterar grava esses valores como escolha explícita — Fase A
 * não modela um terceiro estado "nunca configurado" além de NULL antes do
 * primeiro save.
 */
const DEFAULT_PRIMARY_COLOR = "#7C3AED";
const DEFAULT_SECONDARY_COLOR = "#3B82F6";

function SaveButton({ canEdit }: { canEdit: boolean }) {
  const { pending } = useFormStatus();
  if (!canEdit) return null;
  return (
    <button
      className="rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Salvando…" : "Salvar alterações"}
    </button>
  );
}

export function AppearanceForm({
  canEdit,
  storeName,
  storeDescription,
  initialLogoPath,
  initialPrimaryColor,
  initialSecondaryColor,
  initialTemplate,
}: {
  canEdit: boolean;
  storeName: string;
  storeDescription: string | null;
  initialLogoPath: string | null;
  initialPrimaryColor: string | null;
  initialSecondaryColor: string | null;
  initialTemplate: StorefrontTemplate;
}) {
  const [state, formAction] = useActionState(updateStoreAppearanceAction, initialStoreAppearanceState);

  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoPath ? getTenantMediaPublicUrl(initialLogoPath) : null);
  const [primaryColor, setPrimaryColor] = useState(initialPrimaryColor ?? DEFAULT_PRIMARY_COLOR);
  const [secondaryColor, setSecondaryColor] = useState(initialSecondaryColor ?? DEFAULT_SECONDARY_COLOR);
  const [template, setTemplate] = useState<StorefrontTemplate>(initialTemplate);
  const [suggestedPalette, setSuggestedPalette] = useState<string[]>([]);

  function applyPalette() {
    if (suggestedPalette.length === 0) return;
    if (suggestedPalette[0]) setPrimaryColor(suggestedPalette[0]);
    if (suggestedPalette[1]) setSecondaryColor(suggestedPalette[1]);
  }

  return (
    <form action={formAction} className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]" noValidate>
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
          <h2 className="mb-4 border-b border-surface-container-highest pb-4 font-headline text-headline-sm text-on-surface">
            1. Identidade
          </h2>
          <div className="flex flex-col gap-4">
            <LogoUploader
              initialLogoPath={initialLogoPath}
              onDisplayUrlChange={setLogoUrl}
              onPaletteExtracted={setSuggestedPalette}
            />
            <div className="grid grid-cols-1 gap-1 rounded-lg bg-surface-container-lowest p-3 md:grid-cols-2 md:gap-4">
              <div>
                <p className="font-label text-label-sm uppercase text-on-surface-variant">Nome da loja</p>
                <p className="font-body text-body-sm text-on-surface">{storeName}</p>
              </div>
              <div>
                <p className="font-label text-label-sm uppercase text-on-surface-variant">Descrição</p>
                <p className="font-body text-body-sm text-on-surface-variant">
                  {storeDescription || "Sem descrição — edite em Configurações Gerais."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
          <h2 className="mb-4 border-b border-surface-container-highest pb-4 font-headline text-headline-sm text-on-surface">
            2. Cores da loja
          </h2>
          <div className="flex flex-col gap-4">
            {suggestedPalette.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="font-label text-label-md uppercase text-on-surface-variant">Paleta sugerida pela sua logo</p>
                <div className="flex items-center gap-3">
                  <div className="flex gap-2">
                    {suggestedPalette.map((color) => (
                      <span
                        className="h-8 w-8 rounded-full border border-surface-container-highest"
                        key={color}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                  <button
                    className="rounded-lg bg-primary-container px-4 py-2 font-label text-label-sm text-on-primary-container transition-colors hover:bg-[#8B5CF6]"
                    disabled={!canEdit}
                    onClick={applyPalette}
                    type="button"
                  >
                    Aplicar paleta
                  </button>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ColorInput disabled={!canEdit} label="Cor primária" name="primaryColor" onChange={setPrimaryColor} value={primaryColor} />
              <ColorInput
                disabled={!canEdit}
                label="Cor secundária"
                name="secondaryColor"
                onChange={setSecondaryColor}
                value={secondaryColor}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
          <h2 className="mb-1 font-headline text-headline-sm text-on-surface">3. Estilo da loja</h2>
          <p className="mb-4 border-b border-surface-container-highest pb-4 font-body text-body-sm text-on-surface-variant">
            Escolha o estilo que melhor representa sua marca.
          </p>
          <TemplateSelector disabled={!canEdit} onChange={setTemplate} value={template} />
          <input name="storefrontTemplate" type="hidden" value={template} />
        </div>

        {state.status === "error" && state.message ? (
          <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
            {state.message}
          </p>
        ) : null}
        {state.status === "success" && state.message ? (
          <p className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/10 px-4 py-2 text-body-sm text-[#10B981]" role="status">
            {state.message}
          </p>
        ) : null}

        <div>
          <SaveButton canEdit={canEdit} />
        </div>
      </div>

      <div className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
        <StorePreview
          logoUrl={logoUrl}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          storeName={storeName}
          template={template}
        />
      </div>
    </form>
  );
}
