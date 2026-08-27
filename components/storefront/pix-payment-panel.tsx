"use client";

import { useState } from "react";

import { PIX_KEY_TYPE_LABELS, type PixKeyType } from "@/lib/pix/key-types";

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Mesmo padrão de `components/storefront/checkout-form.tsx::CopyPixKeyButton` — cópia local pequena, não vale uma abstração compartilhada só para isto. Se o clipboard não estiver disponível (`navigator.clipboard` ausente/bloqueado), falha silenciosamente para o texto original — nunca expõe erro técnico ao cliente. */
function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="flex items-center justify-center gap-2 rounded-lg border border-outline-variant/50 px-4 py-2.5 font-label text-label-md text-on-surface transition-colors hover:border-primary/50"
      onClick={() => {
        if (!navigator.clipboard) return;
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => undefined);
      }}
      type="button"
    >
      <span className="material-symbols-outlined text-[18px]">{copied ? "check" : "content_copy"}</span>
      {copied ? copiedLabel : label}
    </button>
  );
}

export interface PixPaymentPanelProps {
  amount: number;
  pixKey: string;
  pixKeyType: PixKeyType;
  recipientName: string;
  copyPasteCode: string;
  qrCodeSvg: string;
}

/**
 * Fase D2-B.2 — painel de pagamento PIX na página de confirmação do
 * pedido (`app/loja/[slug]/pedido/[orderId]/page.tsx`). Todos os dados
 * (valor/chave/nome/QR/Copia-e-Cola) já vêm prontos do servidor
 * (`features/checkout/pix-payment.ts::getPixPaymentDetails`) — este
 * componente só exibe, nunca recalcula nada.
 *
 * `qrCodeSvg` é um SVG gerado inteiramente no servidor
 * (`lib/pix/qr-code.ts`) a partir do payload EMV já sanitizado — nunca
 * contém dado vindo do cliente, por isso é seguro injetar via
 * `dangerouslySetInnerHTML` (mesmo raciocínio de qualquer SVG
 * server-rendered a partir de dado 100% controlado pelo backend).
 *
 * Nunca afirma "pagamento aprovado/confirmado/processado" — o texto deixa
 * claro que a confirmação é manual, pela loja.
 */
export function PixPaymentPanel({ amount, pixKey, pixKeyType, recipientName, copyPasteCode, qrCodeSvg }: PixPaymentPanelProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <h2 className="flex items-center gap-2 font-headline text-headline-sm text-on-surface">
        <span className="material-symbols-outlined text-primary">bolt</span>
        Pagamento via PIX
      </h2>

      <div className="text-center">
        <p className="font-body text-body-sm text-on-surface-variant">Valor a pagar</p>
        <p className="font-headline text-headline-md text-on-surface">{formatBRL(amount)}</p>
      </div>

      <div
        aria-hidden="true"
        className="mx-auto w-full max-w-[240px] overflow-hidden rounded-lg bg-white p-3 [&_svg]:h-auto [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
      />
      <p className="text-center font-body text-body-sm text-on-surface-variant">
        Escaneie o QR Code usando o aplicativo do seu banco.
      </p>

      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-4">
        <p className="font-body text-body-sm text-on-surface-variant">
          Chave PIX ({PIX_KEY_TYPE_LABELS[pixKeyType]}) — {recipientName}
        </p>
        <p className="mt-1 break-all font-label text-label-md text-on-surface">{pixKey}</p>
        <div className="mt-3">
          <CopyButton copiedLabel="Chave copiada!" label="Copiar chave PIX" value={pixKey} />
        </div>
      </div>

      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-4">
        <p className="font-body text-body-sm text-on-surface-variant">PIX Copia e Cola</p>
        <p className="mt-1 max-h-24 overflow-y-auto break-all font-mono text-body-sm text-on-surface">{copyPasteCode}</p>
        <div className="mt-3">
          <CopyButton copiedLabel="Código copiado!" label="Copiar código PIX" value={copyPasteCode} />
        </div>
      </div>

      <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 font-body text-body-sm text-amber-200">
        Após realizar o pagamento, envie o comprovante pelo WhatsApp para a loja confirmar. O pagamento não é aprovado
        automaticamente pela VEXO.
      </p>
    </div>
  );
}
