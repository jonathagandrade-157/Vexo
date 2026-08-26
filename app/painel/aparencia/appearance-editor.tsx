"use client";

import { useMemo, useState } from "react";

import { ColorInput } from "@/components/painel/color-input";
import { TextField } from "@/components/ui/text-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { initialStoreProfileState, updateStoreProfileAction } from "@/features/settings/actions";
import { updateStoreAppearanceAction } from "@/features/settings/appearance-actions";
import { initialStoreAppearanceState, type StorefrontTemplate } from "@/features/settings/appearance-schema";
import { getTenantMediaPublicUrl } from "@/features/settings/logo-storage";
import type { PublicCategory, PublicProductSummary } from "@/features/storefront/catalog";
import { DEFAULT_STORE_PRIMARY_COLOR, DEFAULT_STORE_SECONDARY_COLOR } from "@/lib/color/store-theme";
import { LivePreviewFrame } from "./live-preview-frame";
import { LogoUploader } from "./logo-uploader";
import { TemplateSelector } from "./template-selector";

interface TenantProfile {
  id: string;
  slug: string;
  name: string;
  segment: string | null;
  description: string | null;
  instagramHandle: string | null;
  whatsappPhone: string | null;
  contactEmail: string | null;
}

function SaveButton({ canEdit, onClick, saving }: { canEdit: boolean; onClick: () => void; saving: boolean }) {
  if (!canEdit) return null;
  return (
    <button
      className="rounded-lg bg-primary-container px-6 py-3 font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={saving}
      onClick={onClick}
      type="button"
    >
      {saving ? "Salvando…" : "Salvar alterações"}
    </button>
  );
}

/**
 * Sprint 1 — Fase B3. Editor visual em duas colunas: esquerda = controles
 * (Identidade/Aparência/Modelos/Banners), direita = `LivePreviewFrame`
 * (loja real, mesmos componentes de `components/storefront/`, dados
 * locais). Nome/descrição viram campos editáveis aqui (§9: "alterar nome
 * → preview muda"), mas continuam com uma ÚNICA fonte de verdade no banco
 * — `tenants.name`/`description` — salvos por `updateStoreProfileAction`,
 * a MESMA Action de Configurações Geral, nunca uma coluna/schema paralelo
 * (§16: "não criar campos duplicados"). Um clique em "Salvar alterações"
 * dispara as duas Actions que já existiam (perfil + aparência) — cada uma
 * já revalida sua própria permissão/RLS no servidor, exatamente como
 * antes; esta tela só chama as duas em vez de uma.
 */
export function AppearanceEditor({
  canEdit,
  tenant,
  categories,
  products,
  promotions,
  initialLogoPath,
  initialPrimaryColor,
  initialSecondaryColor,
  initialTemplate,
}: {
  canEdit: boolean;
  tenant: TenantProfile;
  categories: PublicCategory[];
  products: PublicProductSummary[];
  promotions: PublicProductSummary[];
  initialLogoPath: string | null;
  initialPrimaryColor: string | null;
  initialSecondaryColor: string | null;
  initialTemplate: StorefrontTemplate;
}) {
  const [name, setName] = useState(tenant.name);
  const [description, setDescription] = useState(tenant.description ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoPath ? getTenantMediaPublicUrl(initialLogoPath) : null);
  const [primaryColor, setPrimaryColor] = useState(initialPrimaryColor ?? DEFAULT_STORE_PRIMARY_COLOR);
  const [secondaryColor, setSecondaryColor] = useState(initialSecondaryColor ?? DEFAULT_STORE_SECONDARY_COLOR);
  const [template, setTemplate] = useState<StorefrontTemplate>(initialTemplate);
  const [suggestedPalette, setSuggestedPalette] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "success" | "error"; message?: string }>({
    status: "idle",
  });

  function applyPalette() {
    if (suggestedPalette.length === 0) return;
    if (suggestedPalette[0]) setPrimaryColor(suggestedPalette[0]);
    if (suggestedPalette[1]) setSecondaryColor(suggestedPalette[1]);
  }

  async function handleSave() {
    setSaveState({ status: "saving" });

    const appearanceForm = new FormData();
    appearanceForm.set("primaryColor", primaryColor);
    appearanceForm.set("secondaryColor", secondaryColor);
    appearanceForm.set("storefrontTemplate", template);
    const appearanceResult = await updateStoreAppearanceAction(initialStoreAppearanceState, appearanceForm);
    if (appearanceResult.status === "error") {
      setSaveState({ status: "error", message: appearanceResult.message ?? "Não foi possível salvar a aparência." });
      return;
    }

    const nameChanged = name.trim() !== tenant.name;
    const descriptionChanged = description.trim() !== (tenant.description ?? "");

    if (nameChanged || descriptionChanged) {
      const profileForm = new FormData();
      profileForm.set("storeName", name);
      profileForm.set("segment", tenant.segment ?? "");
      profileForm.set("description", description);
      profileForm.set("instagram", tenant.instagramHandle ?? "");
      profileForm.set("whatsapp", tenant.whatsappPhone ?? "");
      profileForm.set("email", tenant.contactEmail ?? "");
      const profileResult = await updateStoreProfileAction(initialStoreProfileState, profileForm);
      if (profileResult.status === "error") {
        setSaveState({ status: "error", message: profileResult.message ?? "Não foi possível salvar o nome/descrição." });
        return;
      }
    }

    setSaveState({ status: "success", message: "Alterações salvas." });
  }

  const previewPayload = useMemo(
    () => ({
      tenant: {
        id: tenant.id,
        name,
        slug: tenant.slug,
        segment: tenant.segment,
        description: description.trim() ? description : null,
        instagram_handle: tenant.instagramHandle,
        whatsapp_phone: tenant.whatsappPhone,
        contact_email: tenant.contactEmail,
        logo_url: logoUrl,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        storefront_template: template,
      },
      categories,
      products,
      promotions,
    }),
    [tenant, name, description, logoUrl, primaryColor, secondaryColor, template, categories, products, promotions],
  );

  return (
    <div className="grid grid-cols-1 gap-6 xl:h-[calc(100vh-140px)] xl:grid-cols-[2fr_3fr]">
      <div className="flex flex-col gap-6 xl:overflow-y-auto xl:pr-2">
        <section className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
          <h2 className="mb-4 border-b border-surface-container-highest pb-4 font-headline text-headline-sm text-on-surface">
            Identidade
          </h2>
          <div className="flex flex-col gap-4">
            <LogoUploader initialLogoPath={initialLogoPath} onDisplayUrlChange={setLogoUrl} onPaletteExtracted={setSuggestedPalette} />
            <TextField
              defaultValue={name}
              disabled={!canEdit}
              icon="storefront"
              id="appearance-store-name"
              label="Nome da loja"
              name="storeName"
              onChange={setName}
            />
            <TextareaField
              defaultValue={description}
              disabled={!canEdit}
              id="appearance-description"
              label="Descrição"
              name="description"
              onChange={setDescription}
            />
          </div>
        </section>

        <section className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
          <h2 className="mb-4 border-b border-surface-container-highest pb-4 font-headline text-headline-sm text-on-surface">
            Aparência
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
        </section>

        <section className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
          <h2 className="mb-1 font-headline text-headline-sm text-on-surface">Modelos</h2>
          <p className="mb-4 border-b border-surface-container-highest pb-4 font-body text-body-sm text-on-surface-variant">
            Escolha o estilo que melhor representa sua marca.
          </p>
          <TemplateSelector disabled={!canEdit} onChange={setTemplate} value={template} />
        </section>

        {/* Sprint 1 — Fase B3 §5/§17: espaço reservado, sem CRUD/tabela/bucket ainda (Fase C2). */}
        <section className="rounded-xl border border-dashed border-surface-container-highest bg-[#121212]/50 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-headline text-headline-sm text-on-surface">Banners</h2>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                Carrossel de imagens no topo da loja.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-surface-container-high px-3 py-1 font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              Em breve
            </span>
          </div>
        </section>

        {saveState.status === "error" ? (
          <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-2 text-body-sm text-error" role="alert">
            {saveState.message}
          </p>
        ) : null}
        {saveState.status === "success" ? (
          <p className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/10 px-4 py-2 text-body-sm text-[#10B981]" role="status">
            {saveState.message}
          </p>
        ) : null}

        <div>
          <SaveButton canEdit={canEdit} onClick={handleSave} saving={saveState.status === "saving"} />
        </div>
      </div>

      <div className="xl:h-full">
        <LivePreviewFrame payload={previewPayload} publicStoreHref={`/loja/${tenant.slug}`} />
      </div>
    </div>
  );
}
