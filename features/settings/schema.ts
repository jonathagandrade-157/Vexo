import { z } from "zod";

/**
 * Mesma forma de `features/onboarding/schema.ts` (allowlist Zod,
 * arquitetura §10/§18) — os mesmos 6 campos da Etapa 4, editáveis depois
 * do onboarding em `/painel/configuracoes`. Sem campo novo: nada de
 * CNPJ/CPF/endereço (a tela `vexo_configura_es_gerais` do Stitch mostra
 * esses campos, mas não existem na Etapa 4 e a instrução da Etapa 5 é
 * clara — usar só os dados que já existem, não inventar campo porque
 * "parece útil").
 */
export const storeProfileSchema = z.object({
  storeName: z.string().trim().min(2, "Informe o nome da loja").max(120),
  segment: z.enum(["apparel", "electronics", "beauty", "home", "other"], {
    message: "Selecione um segmento",
  }),
  description: z
    .string()
    .trim()
    .max(500, "Máximo de 500 caracteres")
    .optional()
    .transform((v) => (v ? v : undefined)),
  instagram: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@+/, ""))
    .refine((v) => v.length > 0 && v.length <= 60, "Instagram inválido"),
  whatsapp: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, "").length >= 10, "WhatsApp inválido"),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
});

export type StoreProfileInput = z.infer<typeof storeProfileSchema>;
