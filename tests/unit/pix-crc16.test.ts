import { describe, expect, it } from "vitest";
import { crc16ccitt } from "@/lib/pix/crc16";

describe("crc16ccitt", () => {
  it("bate com o vetor de teste público e independente de PIX do catálogo CRC-16/CCITT-FALSE", () => {
    // https://reveng.sourceforge.io/crc-catalogue/16.htm — CRC-16/CCITT-FALSE,
    // check value para a string ASCII "123456789" é 0x29B1. Validar contra
    // este vetor confirma o algoritmo em si (poly 0x1021, init 0xFFFF, sem
    // reflexão, sem XOR final), independente de qualquer suposição
    // específica deste projeto sobre o padrão do Bacen.
    expect(crc16ccitt("123456789")).toBe("29B1");
  });

  it("sempre devolve 4 caracteres hexadecimais maiúsculos", () => {
    for (const input of ["", "a", "payload pix qualquer", "0".repeat(200)]) {
      const result = crc16ccitt(input);
      expect(result).toMatch(/^[0-9A-F]{4}$/);
    }
  });

  it("bate com um payload PIX real publicado externamente (fonte independente deste projeto)", () => {
    // Fase D2-B.2 Etapa 3 — vetor de validação cruzada, obtido de um post
    // técnico externo sobre geração de BR Code (não escrito por este
    // projeto), payload com chave aleatória + BRASILIA, CRC conhecido
    // "1D3D". Confirma não só o algoritmo (já validado acima contra
    // "123456789"), mas também o ESCOPO do cálculo específico do PIX: o
    // CRC é sobre o payload inteiro incluindo o literal "6304" (id+
    // tamanho do próprio campo do CRC) antes do valor do CRC em si — o
    // erro mais comum documentado na comunidade Pix é calcular sem esse
    // prefixo.
    const withoutCrc =
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
    expect(crc16ccitt(withoutCrc)).toBe("1D3D");
  });

  it("é determinístico: a mesma entrada sempre produz o mesmo CRC", () => {
    const input = "00020126360014br.gov.bcb.pix";
    expect(crc16ccitt(input)).toBe(crc16ccitt(input));
  });

  it("muda quando a entrada muda", () => {
    expect(crc16ccitt("payload-a")).not.toBe(crc16ccitt("payload-b"));
  });
});
