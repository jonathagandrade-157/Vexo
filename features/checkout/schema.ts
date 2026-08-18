import { z } from "zod";

/** Mesmos 27 estados reais do Brasil — dado de referência estático, não fictício (prompt §18: "sem dados fictícios"). */
export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

const emptyToUndefined = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);

/** Mesma validação de nome/e-mail/telefone já usada no cadastro do lojista (features/auth/schema.ts, Etapa 3) — não reinventada aqui. */
export const checkoutSchema = z.object({
  customerName: z.string().trim().min(2, "Informe seu nome completo").max(120),
  customerEmail: z.string().trim().toLowerCase().email("E-mail inválido"),
  customerPhone: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, "").length >= 10, "Telefone inválido"),
  zip: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, "").length === 8, "CEP inválido")
    .transform((v) => v.replace(/\D/g, "")),
  street: z.string().trim().min(2, "Informe o endereço").max(200),
  number: z.string().trim().min(1, "Informe o número").max(20),
  complement: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  neighborhood: z.string().trim().min(2, "Informe o bairro").max(100),
  city: z.string().trim().min(2, "Informe a cidade").max(100),
  state: z.enum(BRAZILIAN_STATES, { message: "Selecione um estado" }),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Definido aqui (não em actions.ts) — mesmo motivo de sempre (bug de "use server" com export não-função, Etapa 5). */
export interface CheckoutActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof CheckoutInput, string>>;
}

export const initialCheckoutState: CheckoutActionState = { status: "idle" };
