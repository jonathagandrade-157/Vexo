"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveOnboardingTenant } from "./resolve-tenant";
import { brandInfoSchema, type BrandInfoInput } from "./schema";

export interface BrandInfoActionState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof BrandInfoInput, string>>;
}

export const initialBrandInfoState: BrandInfoActionState = { status: "idle" };

/**
 * Único passo de dados da Etapa 4 (arquitetura §24 Etapa 4;
 * docs/architecture/etapa-4-onboarding.md).
 *
 * O tenant a atualizar NUNCA vem de um campo do formulário — é resolvido
 * aqui a partir da sessão (auth.getUser() + tenant_members), exatamente
 * como resolveOnboardingTenant faz para renderizar a página. Isso fecha o
 * cenário de IDOR/tenant hopping "enviar um tenant_id de outra loja no
 * formulário": não há onde colocar esse valor para começar.
 *
 * O UPDATE roda no cliente Supabase ligado à sessão (não service_role) —
 * RLS (`has_permission(id, 'settings.update')`, Etapa 2) continua sendo a
 * autoridade final; resolver o tenant no servidor é defesa em
 * profundidade, não substituição da RLS.
 *
 * Idempotente por natureza: é um UPDATE de uma linha já existente, nunca
 * um INSERT — reenvio duplo (double submit, ou o usuário voltando à
 * página depois de já ter concluído) não cria linha duplicada nenhuma; o
 * trigger de auditoria (0019) só loga a conclusão na primeira vez
 * (transição null → not null).
 */
export async function saveBrandInfoAction(
  _prevState: BrandInfoActionState,
  formData: FormData,
): Promise<BrandInfoActionState> {
  const parsed = brandInfoSchema.safeParse({
    storeName: formData.get("storeName"),
    segment: formData.get("segment"),
    description: formData.get("description"),
    instagram: formData.get("instagram"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    const fieldErrors: BrandInfoActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof BrandInfoInput;
      fieldErrors[key] ??= issue.message;
    }
    return {
      status: "error",
      fieldErrors,
      message: "Verifique os campos destacados.",
    };
  }

  const supabase = await createSupabaseServerClient();

  const tenant = await resolveOnboardingTenant(supabase, true);
  if (!tenant) {
    // Sem sessão, sem tenant, ou onboarding já concluído por outra aba —
    // não há o que salvar aqui; a página que chamou esta action já faz o
    // redirect correto no próximo GET.
    redirect("/painel");
  }

  const { storeName, segment, description, instagram, whatsapp, email } = parsed.data;

  const { error } = await supabase
    .from("tenants")
    .update({
      name: storeName,
      segment,
      description: description ?? null,
      instagram_handle: instagram,
      whatsapp_phone: whatsapp,
      contact_email: email,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("id", tenant.id);

  if (error) {
    return {
      status: "error",
      message: "Não foi possível salvar os dados da sua loja. Tente novamente.",
    };
  }

  redirect("/painel");
}
