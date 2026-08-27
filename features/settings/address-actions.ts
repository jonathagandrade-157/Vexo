"use server";

import { revalidatePath } from "next/cache";

import { resolveActiveTenantForUser } from "@/features/onboarding/resolve-tenant";
import { lookupCep, type CepLookupResult } from "@/lib/address/cep-lookup";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { storeAddressSchema, type StoreAddressActionState, type StoreAddressInput } from "./address-schema";

const CONFIGURACOES_PATH = "/painel/configuracoes";

/** Mesmo checklist de sempre — cópia local, não compartilhada (mesmo padrão de pix/whatsapp/checkout-actions.ts). */
async function resolveTenantAndPermission(): Promise<{ tenantId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient();
  const membership = await resolveActiveTenantForUser(supabase);
  if (!membership || membership.tenant.onboarding_completed_at === null) {
    return { error: "Nenhuma loja configurada para esta conta." };
  }

  const { data: allowed } = await supabase.rpc("has_permission", {
    p_tenant_id: membership.tenant.id,
    p_permission_key: "settings.update",
  });
  if (!allowed) {
    return { error: "Você não tem permissão para alterar o endereço da loja." };
  }

  return { tenantId: membership.tenant.id };
}

export interface LookupStoreAddressResult {
  status: "found" | "not_found";
  data?: CepLookupResult;
}

/**
 * Fase D2-B.2 — autofill pontual (chamado quando o lojista digita/confirma
 * o CEP da própria loja, nunca automaticamente a cada tecla e nunca no
 * checkout do cliente). Não persiste nada — só devolve o que a BrasilAPI
 * encontrou para o formulário preencher os campos (ainda editáveis). Se a
 * consulta falhar por qualquer motivo (timeout, CEP inexistente, serviço
 * fora do ar), devolve `not_found`: o lojista preenche manualmente, o
 * cadastro nunca fica bloqueado por uma API externa indisponível.
 *
 * Não exige tenant/permissão de escrita — é só uma consulta de leitura de
 * um serviço público, sem efeito nenhum sobre dados do tenant.
 */
export async function lookupStoreAddressAction(zip: string): Promise<LookupStoreAddressResult> {
  const result = await lookupCep(zip);
  if (!result) return { status: "not_found" };
  return { status: "found", data: result };
}

/**
 * Fase D2-B.2. Endereço da loja é opcional e pode ficar incompleto nesta
 * fase (sem exigência de "tudo ou nada") — a única exigência de
 * completude é cruzada com PIX: `tenants_pix_enabled_requires_key_check`
 * (migration 084) rejeita a UPDATE se o lojista tentar apagar
 * `address_city` enquanto `pix_enabled=true`. Aqui, checamos isso antes de
 * tentar a UPDATE só para devolver uma mensagem amigável em vez do erro
 * bruto do Postgres (nunca exposto ao lojista) — a constraint do banco
 * continua sendo a autoridade final (defesa em profundidade).
 */
export async function updateStoreAddressAction(
  _prevState: StoreAddressActionState,
  formData: FormData,
): Promise<StoreAddressActionState> {
  const parsed = storeAddressSchema.safeParse({
    zip: formData.get("zip"),
    street: formData.get("street"),
    number: formData.get("number"),
    complement: formData.get("complement"),
    neighborhood: formData.get("neighborhood"),
    city: formData.get("city"),
    state: formData.get("state"),
  });
  if (!parsed.success) {
    const fieldErrors: StoreAddressActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof StoreAddressInput;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", fieldErrors, message: "Verifique os campos destacados." };
  }

  const resolved = await resolveTenantAndPermission();
  if ("error" in resolved) return { status: "error", message: resolved.error };

  const supabase = await createSupabaseServerClient();

  if (!parsed.data.city) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("pix_enabled")
      .eq("id", resolved.tenantId)
      .maybeSingle();
    if (tenant?.pix_enabled) {
      return {
        status: "error",
        fieldErrors: { city: "Obrigatória enquanto o PIX estiver habilitado." },
        message: "Não é possível remover a cidade enquanto o PIX estiver habilitado. Desative o PIX primeiro.",
      };
    }
  }

  const { zip, street, number, complement, neighborhood, city, state } = parsed.data;

  const { error } = await supabase
    .from("tenants")
    .update({
      address_zip: zip ?? null,
      address_street: street ?? null,
      address_number: number ?? null,
      address_complement: complement ?? null,
      address_neighborhood: neighborhood ?? null,
      address_city: city ?? null,
      address_state: state ?? null,
    })
    .eq("id", resolved.tenantId);

  if (error) {
    return { status: "error", message: "Não foi possível salvar o endereço. Tente novamente." };
  }

  revalidatePath(CONFIGURACOES_PATH);
  return { status: "success", message: "Endereço salvo." };
}
