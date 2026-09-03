import { NextResponse, type NextRequest } from "next/server";

import { lookupCep } from "@/lib/address/cep-lookup";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "@/lib/security/rate-limit";

/**
 * D15-S.2 — 20 requisições/60s por IP (nunca por tenant — este endpoint
 * não é escopado por loja, ver comentário abaixo). Mais generoso que
 * shipping/quote de propósito: a BrasilAPI é gratuita e sem chave (custo
 * zero por chamada, comentário abaixo), então o risco aqui é só
 * disponibilidade/abuso de banda, não custo financeiro direto.
 */
const CEP_LOOKUP_WINDOW_SECONDS = 60;
const CEP_LOOKUP_MAX_REQUESTS = 20;

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

  // D15-S.2 — fail-OPEN de propósito, ao contrário de shipping/quote: a
  // BrasilAPI é gratuita/sem chave (sem custo por chamada, comentário de
  // lookupCep em lib/address/cep-lookup.ts), então bloquear o autofill do
  // checkout inteiro por uma falha transitória do limiter custaria mais
  // em experiência do lojista/cliente do que o risco real de abuso vale a
  // pena aceitar por essa janela curta.
  const ip = getClientIp(request) ?? "unknown";
  const rateLimit = await checkRateLimit(`cep-lookup:${ip}`, CEP_LOOKUP_WINDOW_SECONDS, CEP_LOOKUP_MAX_REQUESTS);
  if (rateLimit && !rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
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
