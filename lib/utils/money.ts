/**
 * D3.2-B Ponto 2E — comparação monetária exata. Auditado antes de criar:
 * nenhuma função utilitária de comparação/normalização monetária existia
 * no projeto — o único precedente (`features/shipping/checkout.ts::verifyShippingPriceFresh`)
 * usa `Math.abs(a - b) > 0.01`, uma comparação de ponto flutuante com
 * epsilon, não uma comparação decimal exata.
 *
 * Para a revalidação da cotação Melhor Envio — onde o preço vem como
 * string decimal da API ("27.48") e precisa ser comparado com o valor
 * que o cliente informou — arredondar para centavos inteiros (mesma
 * granularidade de `numeric(10,2)` no Postgres, o tipo usado em todo
 * valor monetário do VEXO) e comparar como inteiro evita qualquer
 * imprecisão de ponto flutuante binário (`0.1 + 0.2 !== 0.3`), sem
 * depender de um epsilon escolhido arbitrariamente.
 */

/** Converte para centavos inteiros, arredondando (nunca truncando) — mesma granularidade de `numeric(10,2)`. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

/** `true` somente se os dois valores representam exatamente o mesmo valor em centavos. */
export function pricesMatchExactly(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}
