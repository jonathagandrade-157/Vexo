import { describe, expect, it } from "vitest";
import {
  isValidCnpj,
  isValidCpf,
  isValidCpfOrCnpj,
} from "@/lib/security/document-validation";

// 529.982.247-25 and 11.222.333/0001-81 are the standard publicly-known
// valid test CPF/CNPJ used across Brazilian dev tooling/documentation.
describe("isValidCpf", () => {
  it("accepts a valid CPF, formatted or raw", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidCpf("123")).toBe(false);
  });

  it("rejects all-repeated digits", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });

  it("rejects a bad check digit", () => {
    expect(isValidCpf("529.982.247-26")).toBe(false);
  });
});

describe("isValidCnpj", () => {
  it("accepts a valid CNPJ, formatted or raw", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });

  it("rejects all-repeated digits", () => {
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
  });

  it("rejects a bad check digit", () => {
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
  });
});

describe("isValidCpfOrCnpj", () => {
  it("dispatches by normalized length", () => {
    expect(isValidCpfOrCnpj("529.982.247-25")).toBe(true);
    expect(isValidCpfOrCnpj("11.222.333/0001-81")).toBe(true);
  });

  it("rejects a document of neither length", () => {
    expect(isValidCpfOrCnpj("12345")).toBe(false);
  });
});
