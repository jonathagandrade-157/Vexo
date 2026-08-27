import { describe, expect, it } from "vitest";
import { crc16ccitt } from "@/lib/pix/crc16";
import { buildPixPayload, type PixPayloadInput } from "@/lib/pix/payload";

/**
 * Parser TLV independente da implementação em `lib/pix/payload.ts` — não
 * reaproveita `tlv()` de lá. Decodificar de volta e checar os valores é o
 * jeito robusto de testar um encoder EMV, em vez de comparar contra uma
 * string esperada inteira hardcoded (frágil a qualquer reordenação
 * inofensiva de campos).
 */
function parseTlv(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < raw.length) {
    const id = raw.slice(i, i + 2);
    const length = Number(raw.slice(i + 2, i + 4));
    const value = raw.slice(i + 4, i + 4 + length);
    fields[id] = value;
    i += 4 + length;
  }
  return fields;
}

function field(fields: Record<string, string>, id: string): string {
  const value = fields[id];
  if (value === undefined) throw new Error(`campo TLV ${id} ausente no payload`);
  return value;
}

const baseInput: PixPayloadInput = {
  pixKey: "11999999999",
  pixKeyType: "phone",
  recipientName: "Loja Exemplo",
  city: "São Paulo",
  amount: 150,
  txid: "PED000123",
};

describe("buildPixPayload — estrutura EMV/TLV", () => {
  it("Payload Format Indicator (00) é sempre '01'", () => {
    const fields = parseTlv(buildPixPayload(baseInput));
    expect(fields["00"]).toBe("01");
  });

  it("Point of Initiation Method (01) é '11' (estático, valor fixo por transação)", () => {
    const fields = parseTlv(buildPixPayload(baseInput));
    expect(fields["01"]).toBe("11");
  });

  it("Merchant Account Information (26) contém o GUI fixo br.gov.bcb.pix e a chave", () => {
    const fields = parseTlv(buildPixPayload(baseInput));
    const merchantAccountInfo = parseTlv(field(fields, "26"));
    expect(merchantAccountInfo["00"]).toBe("br.gov.bcb.pix");
    expect(merchantAccountInfo["01"]).toBe("+11999999999");
  });

  it("Merchant Category Code (52) e Currency (53)/Country (58) fixos", () => {
    const fields = parseTlv(buildPixPayload(baseInput));
    expect(fields["52"]).toBe("0000");
    expect(fields["53"]).toBe("986");
    expect(fields["58"]).toBe("BR");
  });

  it("Transaction Amount (54) é o valor exato do pedido, com duas casas decimais", () => {
    const fields = parseTlv(buildPixPayload({ ...baseInput, amount: 513.01 }));
    expect(fields["54"]).toBe("513.01");
  });

  it("Additional Data Field Template (62) contém o txid (05) igual ao order_number", () => {
    const fields = parseTlv(buildPixPayload(baseInput));
    const additionalData = parseTlv(field(fields, "62"));
    expect(additionalData["05"]).toBe("PED000123");
  });

  it("CRC16 (63) é o último campo e bate com o CRC recalculado sobre tudo antes dele + '6304'", () => {
    const payload = buildPixPayload(baseInput);
    const crcFromPayload = payload.slice(-4);
    const withoutCrc = payload.slice(0, -4);
    expect(withoutCrc.endsWith("6304")).toBe(true);
    expect(crcFromPayload).toBe(crc16ccitt(withoutCrc));
  });
});

describe("buildPixPayload — ordem dos campos (Fase D2-B.2 Etapa 3)", () => {
  it("emite os IDs de nível raiz na mesma ordem de um payload PIX estático de referência (00,01,26,52,53,54,58,59,60,62,63)", () => {
    const payload = buildPixPayload(baseInput);
    const ids: string[] = [];
    let i = 0;
    while (i < payload.length) {
      const id = payload.slice(i, i + 2);
      ids.push(id);
      if (id === "63") break; // CRC é sempre o último campo, valor de tamanho fixo (4), não TLV recursivo
      const length = Number(payload.slice(i + 2, i + 4));
      i += 4 + length;
    }
    expect(ids).toEqual(["00", "01", "26", "52", "53", "54", "58", "59", "60", "62", "63"]);
  });
});

describe("buildPixPayload — chave PIX por tipo", () => {
  it("chave telefone recebe o prefixo '+' exigido pelo padrão, mesmo salva sem ele", () => {
    const fields = parseTlv(buildPixPayload({ ...baseInput, pixKeyType: "phone", pixKey: "5511999999999" }));
    const merchantAccountInfo = parseTlv(field(fields, "26"));
    expect(merchantAccountInfo["01"]).toBe("+5511999999999");
  });

  it("não duplica o '+' se a chave telefone já vier com ele", () => {
    const fields = parseTlv(buildPixPayload({ ...baseInput, pixKeyType: "phone", pixKey: "+5511999999999" }));
    const merchantAccountInfo = parseTlv(field(fields, "26"));
    expect(merchantAccountInfo["01"]).toBe("+5511999999999");
  });

  it("chave CPF/CNPJ, e-mail e aleatória vão para o payload exatamente como salvas", () => {
    for (const [pixKeyType, pixKey] of [
      ["cpf_cnpj", "12345678901"],
      ["email", "loja@example.com"],
      ["random", "123e4567-e89b-12d3-a456-426614174000"],
    ] as const) {
      const fields = parseTlv(buildPixPayload({ ...baseInput, pixKeyType, pixKey }));
      const merchantAccountInfo = parseTlv(field(fields, "26"));
      expect(merchantAccountInfo["01"]).toBe(pixKey);
    }
  });
});

describe("buildPixPayload — sanitização de nome/cidade (nunca altera o valor salvo, só o payload)", () => {
  it("remove acentos e converte para maiúsculas", () => {
    const fields = parseTlv(buildPixPayload({ ...baseInput, city: "São Paulo", recipientName: "João da Área" }));
    expect(fields["60"]).toBe("SAO PAULO");
    expect(fields["59"]).toBe("JOAO DA AREA");
  });

  it("respeita o limite de 15 caracteres do Merchant City", () => {
    const fields = parseTlv(buildPixPayload({ ...baseInput, city: "São Paulo dos Campos Grandes" }));
    expect(field(fields, "60").length).toBeLessThanOrEqual(15);
  });

  it("respeita o limite de 25 caracteres do Merchant Name", () => {
    const fields = parseTlv(buildPixPayload({ ...baseInput, recipientName: "Uma Loja Com Nome Extremamente Longo Demais" }));
    expect(field(fields, "59").length).toBeLessThanOrEqual(25);
  });

  it("remove caracteres especiais fora do charset (mantém só letras/números/espaço, sem espaços duplos)", () => {
    const fields = parseTlv(buildPixPayload({ ...baseInput, recipientName: "Loja & Cia. Ltda!!", city: "São Paulo/SP" }));
    expect(fields["59"]).toBe("LOJA CIA LTDA");
    expect(fields["60"]).toBe("SAO PAULOSP");
  });
});

describe("buildPixPayload — valor e comportamento com dados diferentes", () => {
  it("rejeita valor zero", () => {
    expect(() => buildPixPayload({ ...baseInput, amount: 0 })).toThrow();
  });

  it("rejeita valor negativo", () => {
    expect(() => buildPixPayload({ ...baseInput, amount: -10 })).toThrow();
  });

  it("rejeita valor não finito (NaN/Infinity)", () => {
    expect(() => buildPixPayload({ ...baseInput, amount: Number.NaN })).toThrow();
    expect(() => buildPixPayload({ ...baseInput, amount: Number.POSITIVE_INFINITY })).toThrow();
  });

  it("o payload muda quando o valor muda", () => {
    const a = buildPixPayload({ ...baseInput, amount: 100 });
    const b = buildPixPayload({ ...baseInput, amount: 200 });
    expect(a).not.toBe(b);
  });

  it("o payload muda quando o pedido (txid) muda", () => {
    const a = buildPixPayload({ ...baseInput, txid: "PED000001" });
    const b = buildPixPayload({ ...baseInput, txid: "PED000002" });
    expect(a).not.toBe(b);
  });

  it("o txid remove caracteres não alfanuméricos (nunca o UUID do pedido, que tem hífens)", () => {
    const fields = parseTlv(buildPixPayload({ ...baseInput, txid: "not-a-valid-order-number!!" }));
    const additionalData = parseTlv(field(fields, "62"));
    expect(additionalData["05"]).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it("nunca gera payload vazio", () => {
    expect(buildPixPayload(baseInput).length).toBeGreaterThan(0);
  });
});
