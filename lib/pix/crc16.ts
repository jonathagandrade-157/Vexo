/**
 * Fase D2-B.2 — CRC16 exigido pelo campo 63 do padrão EMV/BR Code do
 * Banco Central (Manual de Padrões para Iniciação do Pix). Variante
 * CRC-16/CCITT-FALSE: polinômio 0x1021, valor inicial 0xFFFF, sem
 * reflexão de entrada/saída, sem XOR final — a mesma usada por todo
 * gerador de BR Code em produção.
 *
 * Testado (`tests/unit/pix-crc16.test.ts`) contra o vetor de teste padrão
 * e público do catálogo CRC-16/CCITT-FALSE (ASCII "123456789" → 0x29B1) —
 * independente do domínio PIX, então valida o algoritmo em si, não uma
 * suposição específica deste projeto sobre o padrão do Bacen.
 */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
