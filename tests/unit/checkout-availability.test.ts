import { describe, expect, it } from "vitest";

import { isWhatsappConfigured, resolveCheckoutAvailability } from "@/features/checkout/checkout-availability";

/**
 * D14.1 — lógica pura de decisão do checkout (online vs. WhatsApp vs.
 * fallback vs. dead-end real), mesmo princípio de testabilidade já usado
 * em `features/products/gallery-logic.ts` (D13.1) e
 * `features/onboarding/progress-logic.ts` (D12.2): sem banco, sem React,
 * cobrindo exatamente os cenários exigidos pelo prompt §18.
 */

const VALID_PHONE = "11987654321"; // celular SP válido, sem DDI
const OTHER_TENANT_VALID_PHONE = "21998765432"; // celular RJ válido, de um tenant DIFERENTE
const INVALID_PHONE = "123"; // curto demais, nunca normaliza

describe("resolveCheckoutAvailability", () => {
  it("vexo + gateway conectado → só online, nunca fallback", () => {
    const result = resolveCheckoutAvailability("vexo", true, VALID_PHONE);
    expect(result).toEqual({ onlineAllowed: true, whatsappAllowed: false, isWhatsappFallback: false });
  });

  it("vexo + gateway ausente + WhatsApp configurado → só WhatsApp, como fallback (checkout_mode nunca muda)", () => {
    const result = resolveCheckoutAvailability("vexo", false, VALID_PHONE);
    expect(result).toEqual({ onlineAllowed: false, whatsappAllowed: true, isWhatsappFallback: true });
  });

  it("vexo + gateway ausente + WhatsApp ausente → nenhum caminho (dead-end real)", () => {
    const result = resolveCheckoutAvailability("vexo", false, null);
    expect(result).toEqual({ onlineAllowed: false, whatsappAllowed: false, isWhatsappFallback: false });
  });

  it("vexo + gateway ausente + telefone configurado mas inválido → mesmo que sem telefone (dead-end real)", () => {
    const result = resolveCheckoutAvailability("vexo", false, INVALID_PHONE);
    expect(result).toEqual({ onlineAllowed: false, whatsappAllowed: false, isWhatsappFallback: false });
  });

  it("whatsapp → sempre só WhatsApp, nunca fallback (é o caminho normal, não substituto), mesmo sem telefone configurado (comportamento preservado)", () => {
    expect(resolveCheckoutAvailability("whatsapp", false, null)).toEqual({
      onlineAllowed: false,
      whatsappAllowed: true,
      isWhatsappFallback: false,
    });
    expect(resolveCheckoutAvailability("whatsapp", true, VALID_PHONE)).toEqual({
      onlineAllowed: false,
      whatsappAllowed: true,
      isWhatsappFallback: false,
    });
  });

  it("both + gateway conectado → os dois caminhos, nunca fallback", () => {
    const result = resolveCheckoutAvailability("both", true, VALID_PHONE);
    expect(result).toEqual({ onlineAllowed: true, whatsappAllowed: true, isWhatsappFallback: false });
  });

  it("both + gateway ausente → só WhatsApp (comportamento já existente, preservado), nunca marcado como fallback", () => {
    const result = resolveCheckoutAvailability("both", false, VALID_PHONE);
    expect(result).toEqual({ onlineAllowed: false, whatsappAllowed: true, isWhatsappFallback: false });
  });

  it("isolamento: o telefone usado é sempre o argumento explícito do próprio tenant, nunca um estado global — dois tenants com telefones diferentes nunca se misturam", () => {
    const tenantA = resolveCheckoutAvailability("vexo", false, VALID_PHONE);
    const tenantB = resolveCheckoutAvailability("vexo", false, OTHER_TENANT_VALID_PHONE);
    // Ambos fazem fallback, cada um com base só no PRÓPRIO telefone — a
    // função nunca lê nada além dos argumentos recebidos (sem estado
    // module-level, sem cache compartilhado entre chamadas).
    expect(tenantA.isWhatsappFallback).toBe(true);
    expect(tenantB.isWhatsappFallback).toBe(true);
  });
});

describe("isWhatsappConfigured", () => {
  it("telefone válido → true", () => {
    expect(isWhatsappConfigured(VALID_PHONE)).toBe(true);
  });

  it("null → false", () => {
    expect(isWhatsappConfigured(null)).toBe(false);
  });

  it("telefone inválido → false", () => {
    expect(isWhatsappConfigured(INVALID_PHONE)).toBe(false);
  });
});
