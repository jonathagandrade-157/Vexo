/**
 * Sprint 1 — Fase A. Extração de paleta 100% local, no navegador (Canvas
 * API nativa) — sem IA externa, sem dependência nova, sem processamento
 * no servidor (nunca decodifica bytes de imagem não confiáveis no
 * backend; roda só depois que o próprio navegador já decodificou o
 * arquivo como uma imagem real via `<img>`, não faz parsing manual de
 * PNG/JPEG/WebP).
 *
 * Heurística simples (não é k-means/clustering "de verdade"): reduz a
 * imagem a uma amostra pequena, quantiza cada canal RGB em poucos níveis,
 * conta frequência por "balde" de cor, descarta baldes muito próximos de
 * branco/preto puro (normalmente fundo da logo, não a cor da marca) e
 * devolve as cores mais frequentes e distintas entre si. Suficiente para
 * uma SUGESTÃO editável pelo lojista — nunca uma extração "correta"
 * garantida. Qualquer falha retorna uma lista vazia em vez de lançar —
 * requisito explícito: nunca bloquear o lojista quando a paleta não pode
 * ser calculada com confiança.
 */

export interface ExtractedPalette {
  colors: string[];
}

const SAMPLE_SIZE = 48;
const QUANTIZE_STEP = 32; // 256 / 32 = 8 níveis por canal

function toHex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}

function isNearWhiteOrBlack(r: number, g: number, b: number): boolean {
  const nearWhite = r > 235 && g > 235 && b > 235;
  const nearBlack = r < 20 && g < 20 && b < 20;
  return nearWhite || nearBlack;
}

/** Distância euclidiana simples no espaço RGB — só para evitar swatches quase idênticos na lista final. */
function isDistinctFrom(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, minDistance = 40): boolean {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db) >= minDistance;
}

/**
 * `image` precisa já estar carregada (evento `load` já disparado) — quem
 * chama é responsável por isso.
 */
export function extractPaletteFromImage(image: HTMLImageElement, maxColors = 5): ExtractedPalette {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { colors: [] };

    ctx.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      if (a < 128) continue; // pixel transparente — não conta
      if (isNearWhiteOrBlack(r, g, b)) continue;

      const qr = Math.round(r / QUANTIZE_STEP) * QUANTIZE_STEP;
      const qg = Math.round(g / QUANTIZE_STEP) * QUANTIZE_STEP;
      const qb = Math.round(b / QUANTIZE_STEP) * QUANTIZE_STEP;
      const key = `${qr},${qg},${qb}`;

      const bucket = buckets.get(key);
      if (bucket) bucket.count += 1;
      else buckets.set(key, { count: 1, r: qr, g: qg, b: qb });
    }

    const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);

    const picked: { r: number; g: number; b: number }[] = [];
    for (const candidate of sorted) {
      if (picked.length >= maxColors) break;
      if (picked.every((p) => isDistinctFrom(p, candidate))) picked.push(candidate);
    }

    return { colors: picked.map((c) => `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`.toUpperCase()) };
  } catch {
    return { colors: [] };
  }
}
