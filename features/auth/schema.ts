import { z } from "zod";
import { isValidCpfOrCnpj } from "@/lib/security/document-validation";

/**
 * Allowlist-style schemas (architecture §10/§18: "toda mutação valida com
 * schema Zod... allowlist explícita de campos" — mitigates mass
 * assignment) for the two forms this stage introduces. Field-level rules
 * mirror `criar_conta_e_elegibilidade_trial`.
 */
export const signUpSchema = z.object({
  storeName: z.string().trim().min(2, "Informe o nome da loja").max(120),
  fullName: z.string().trim().min(2, "Informe seu nome completo").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  phone: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, "").length >= 10, "Telefone inválido"),
  document: z
    .string()
    .trim()
    .refine(isValidCpfOrCnpj, "CPF/CNPJ inválido"),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  password: z.string().min(1, "Informe sua senha"),
});

export type SignInInput = z.infer<typeof signInSchema>;
