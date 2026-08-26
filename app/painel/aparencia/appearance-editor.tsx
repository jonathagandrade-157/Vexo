"use client";

import { useMemo, useState } from "react";

import { ColorInput } from "@/components/painel/color-input";
import { updateStoreAppearanceAction } from "@/features/settings/appearance-actions";
import { initialStoreAppearanceState, type StorefrontTemplate } from "@/features/settings/appearance-schema";
import type { StaffBanner } from "@/features/settings/banner-schema";
import { getTenantMediaPublicUrl } from "@/features/settings/logo-storage";
import type { PublicBanner } from "@/features/storefront/banners";
import type { PublicCategory, PublicProductSummary } from "@/features/storefront/catalog";
import { DEFAULT_STORE_PRIMARY_COLOR, DEFAULT_STORE_SECONDARY_COLOR } from "@/lib/color/store-theme";
import { BannerManager } from "./banner-manager";
import { LivePreviewFrame } from "./live-preview-frame";
import { LogoUploader } from "./logo-uploader";
import { TemplateSelector } from "./template-selector";

interface TenantIdentity {
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
 * Sprint 1 — Fase C2 (correção estrutural). Editor visual em duas colunas
 * — esquerda = controles (Identidade visual/Cores/Modelos/Banners),
 * direita = `LivePreviewFrame` (loja real). Nome/descrição NÃO são mais
 * editados aqui (correção desta fase — antes duplicavam Configurações
 * Geral): a seção "Identidade" virou "Identidade visual", só a logo. O
 * preview continua mostrando nome/descrição reais — vêm de `tenant`
 * (prop, fonte única: `tenants.name`/`description`, a mesma que
 * Configurações edita), nunca de estado local paralelo.
 *
 * `handleSave` agora só chama `updateStoreAppearanceAction` (cor/modelo)
 * — não há mais um segundo formulário de perfil aqui.
 */
export function AppearanceEditor({
  canEdit,
  tenant,
  categories,
  products,
  promotions,
  banners,
  staffBanners,
  initialLogoPath,
  initialPrimaryColor,
  initialSecondaryColor,
  initialTemplate,
}: {
  canEdit: boolean;
  tenant: TenantIdentity;
  categories: PublicCategory[];
  products: PublicProductSummary[];
  promotions: PublicProductSummary[];
  banners: PublicBanner[];
  staffBanners: StaffBanner[];
  initialLogoPath: string | null;
  initialPrimaryColor: string | null;
  initialSecondaryColor: string | null;
  initialTemplate: StorefrontTemplate;
}) {
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

    setSaveState({ status: "success", message: "Alterações salvas." });
  }

  const previewPayload = useMemo(
    () => ({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        segment: tenant.segment,
        description: tenant.description,
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
      banners,
    }),
    [tenant, logoUrl, primaryColor, secondaryColor, template, categories, products, promotions, banners],
  );

  return (
    // Sprint 1 — Fase C2 correção: `minmax(360px, 2fr) minmax(0, 3fr)` em
    // vez de `2fr 3fr` puro — sem o `minmax`, um iframe de 1280px dentro
    // da coluna direita (mesmo escalado visualmente por `transform`, que
    // não muda o tamanho de LAYOUT) contribuía um min-content bem maior
    // que 60% da largura disponível, e o grid "roubava" quase todo o
    // espaço da coluna esquerda para tentar satisfazer isso — o bug
    // relatado ("só aparece a pré-visualização"). O piso de 360px na
    // esquerda e o teto explícito de 0 na direita eliminam essa disputa.
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:h-[calc(100vh-200px)] xl:grid-cols-[minmax(360px,2fr)_minmax(0,3fr)]">
      <div className="flex min-w-0 flex-col gap-6 xl:overflow-y-auto xl:pr-2">
        <section className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
          <h2 className="mb-1 font-headline text-headline-sm text-on-surface">Identidade visual</h2>
          <p className="mb-4 border-b border-surface-container-highest pb-4 font-body text-body-sm text-on-surface-variant">
            Nome e descrição são editados em Configurações — aqui você cuida só da logo.
          </p>
          <LogoUploader initialLogoPath={initialLogoPath} onDisplayUrlChange={setLogoUrl} onPaletteExtracted={setSuggestedPalette} />
        </section>

        <section className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
          <h2 className="mb-4 border-b border-surface-container-highest pb-4 font-headline text-headline-sm text-on-surface">
            Cores
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

        <section className="rounded-xl border border-surface-container-highest bg-[#121212] p-6">
          <h2 className="mb-1 font-headline text-headline-sm text-on-surface">Banners</h2>
          <p className="mb-4 border-b border-surface-container-highest pb-4 font-body text-body-sm text-on-surface-variant">
            Carrossel de imagens no topo da loja — até 5 banners.
          </p>
          <BannerManager banners={staffBanners} canEdit={canEdit} />
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

      <div className="min-w-0 xl:h-full">
        <LivePreviewFrame payload={previewPayload} publicStoreHref={`/loja/${tenant.slug}`} />
      </div>
    </div>
  );
}
