import { NextResponse, type NextRequest } from "next/server";

import { lookupCep } from "@/lib/address/cep-lookup";

/**
 * D3.2-A — autofill de endereço pelo CEP no checkout. Reaproveita
 * `lookupCep` (BrasilAPI v2, já usado no autofill do endereço da loja em
 * Configurações) sem duplicar nenhuma lógica — este Route Handler só
 * expõe o mesmo helper para um fetch client-side, exatamente como
 * `/api/shipping/quote` já faz para a cotação de frete. A BrasilAPI nunca
 * é chamada pelo navegador: só este endpoint (server-side) fala com ela.
 *
 * Não é escopado por tenant — consulta de endereço por CEP é a mesma para
 * qualquer loja, não expõe nem depende de nenhum dado de tenant.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cepRaw = searchParams.get("cep");

  if (!cepRaw) {
    return NextResponse.json({ status: "invalid_cep" }, { status: 400 });
  }

  const cep = cepRaw.replace(/\D/g, "");
  if (cep.length !== 8) {
    return NextResponse.json({ status: "invalid_cep" });
  }

  const result = await lookupCep(cep);
  if (!result) {
    // lookupCep nunca lança e já colapsa CEP inexistente, resposta
    // incompleta, timeout e API fora do ar no mesmo `null` — do ponto de
    // vista do checkout, todos esses casos têm o mesmo tratamento
    // (preenchimento manual, mensagem amigável), então não há necessidade
    // de distingui-los aqui.
    return NextResponse.json({ status: "not_found" });
  }

  return NextResponse.json({ status: "ok", ...result });
}
