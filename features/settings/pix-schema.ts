import { z } from "zod";

import { normalizeBrazilianPhone } from "@/lib/whatsapp/phone";

/**
 * Fase D2-B (revisão final) — PIX direto sem gateway (§5/§22 do prompt).
 * Configuração 1:1 por tenant, colunas escalares em `tenants` (mesmo
 * padrão já usado 3 vezes no projeto para exatamente este formato —
 * tenant_brand_info/tenant_appearance_fields/tenant_checkout_mode — ver
 * justificativa completa na migration 20260817220083). A VEXO nunca gera
 * nem valida a chave junto de nenhum provedor — só guarda o que o
 * lojista digitou, com uma checagem de FORMATO (não de existência real)
 * por tipo, e sempre mostra o aviso de conferência antes de salvar.
 */
export const PIX_KEY_TYPES = ["cpf_cnpj", "email", "phone", "random"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

export const PIX_KEY_TYPE_LABELS: Record<PixKeyType, string> = {
  cpf_cnpj: "CPF/CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Chave aleatória",
};

const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const RANDOM_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pixKeyFormatError(type: PixKeyType, rawKey: string): string | null {
  if (type === "cpf_cnpj") {
    const digits = rawKey.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 14) return "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.";
    return null;
  }
  if (type === "email") {
    return z.string().email().safeParse(rawKey).success ? null : "Informe um e-mail válido.";
  }
  if (type === "phone") {
    return normalizeBrazilianPhone(rawKey) ? null : "Informe um telefone válido, com DDD.";
  }
  // random
  return RANDOM_KEY_PATTERN.test(rawKey.trim()) ? null : "Chave aleatória inválida (formato esperado: UUID).";
}

/**
 * Normaliza a chave para o formato canônico ANTES de persistir — mesmo
 * dado que o checkout/mensagem do WhatsApp vão exibir depois, nunca
 * reformatado em runtime a partir do texto bruto digitado pelo lojista.
 */
export function normalizePixKey(type: PixKeyType, rawKey: string): string {
  if (type === "cpf_cnpj") return rawKey.replace(/\D/g, "");
  if (type === "phone") return normalizeBrazilianPhone(rawKey) ?? rawKey.trim();
  return rawKey.trim();
}

export const pixSettingsSchema = z
  .object({
    enabled: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
    pixKeyType: z.preprocess(emptyToUndefined, z.enum(PIX_KEY_TYPES).optional()),
    pixKey: z.preprocess(emptyToUndefined, z.string().trim().max(140).optional()),
    recipientName: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()),
  })
  .superRefine((data, ctx) => {
    // Desabilitado: nenhum campo é obrigatório — a loja pode desligar o
    // PIX direto sem precisar apagar o que já tinha configurado.
    if (!data.enabled) return;

    if (!data.pixKeyType) {
      ctx.addIssue({ code: "custom", path: ["pixKeyType"], message: "Selecione o tipo de chave." });
    }
    if (!data.pixKey) {
      ctx.addIssue({ code: "custom", path: ["pixKey"], message: "Informe a chave PIX." });
    }
    if (!data.recipientName) {
      ctx.addIssue({ code: "custom", path: ["recipientName"], message: "Informe o nome do recebedor." });
    }
    if (data.pixKeyType && data.pixKey) {
      const formatError = pixKeyFormatError(data.pixKeyType, data.pixKey);
      if (formatError) ctx.addIssue({ code: "custom", path: ["pixKey"], message: formatError });
    }
  });

export type PixSettingsInput = z.infer<typeof pixSettingsSchema>;

export interface PixSettingsActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof PixSettingsInput, string>>;
}

export const initialPixSettingsState: PixSettingsActionState = { status: "idle" };
