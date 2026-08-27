import "server-only";

import QRCode from "qrcode";

/**
 * Fase D2-B.2 — QR Code do payload PIX. Gerado sob demanda a partir do
 * payload (`lib/pix/payload.ts`), nunca armazenado como arquivo — o
 * mesmo payload sempre reproduz o mesmo QR, então persistir a imagem só
 * duplicaria dado derivado sem necessidade nenhuma nesta fase.
 *
 * `qrcode` (npm, MIT, `soldair/node-qrcode`) — auditado antes de
 * adicionar: nenhuma outra lib de QR já existia no projeto (`package.json`
 * só tinha `zod`/`@supabase/*`/`next`/`react` antes desta fase). Gera SVG
 * puro server-side, sem canvas/DOM — funciona direto num Server
 * Component, sem JS extra no cliente para desenhar o QR.
 */
export async function renderPixQrCodeSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
  });
}
