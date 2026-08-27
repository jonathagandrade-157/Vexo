import { describe, expect, it } from "vitest";
import { getCustomerWhatsappLink } from "@/features/orders/customer-whatsapp-link";

describe("getCustomerWhatsappLink", () => {
  it("gera um link wa.me a partir do telefone do pedido, sempre normalizado", () => {
    const link = getCustomerWhatsappLink("PED000123", "João Silva", "(11) 99999-9999");
    expect(link).toBe("https://wa.me/5511999999999?text=" + encodeURIComponent("Olá João! Aqui é da loja, sobre o seu pedido PED000123."));
  });

  it("retorna null para telefone inválido — nunca lança, nunca gera um link quebrado", () => {
    expect(getCustomerWhatsappLink("PED000123", "João", "123")).toBeNull();
  });

  it("usa só o primeiro nome do cliente na mensagem", () => {
    const link = getCustomerWhatsappLink("PED000999", "Maria Aparecida Souza", "11999999999");
    expect(link).toContain(encodeURIComponent("Olá Maria!"));
  });
});
