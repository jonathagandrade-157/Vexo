import { describe, expect, it } from "vitest";

import { signUpSchema } from "@/features/auth/schema";

const validSignUp = {
  storeName: "Loja Exemplo",
  fullName: "Maria Silva",
  email: "maria@example.com",
  phone: "(11) 99999-9999",
  document: "529.982.247-25",
  password: "senha-segura",
  acceptTerms: "on",
};

describe("signUpSchema", () => {
  it("aceita o cadastro quando os termos foram aceitos", () => {
    expect(signUpSchema.safeParse(validSignUp).success).toBe(true);
  });

  it("rejeita o cadastro quando o aceite dos termos é omitido", () => {
    const result = signUpSchema.safeParse({ ...validSignUp, acceptTerms: null });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.acceptTerms).toEqual([
        "É necessário aceitar os termos para continuar.",
      ]);
    }
  });
});
