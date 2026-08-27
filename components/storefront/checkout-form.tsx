"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { OrderSummary, type OrderSummaryLine } from "@/components/storefront/order-summary";
import { createOrderAction } from "@/features/checkout/actions";
import { BRAZILIAN_STATES, initialCheckoutState } from "@/features/checkout/schema";
import type { StorePixSettings } from "@/features/checkout/pix-settings";
import { createOrderForWhatsappAction } from "@/features/checkout/whatsapp-actions";
import { initialCheckoutWhatsappState } from "@/features/checkout/whatsapp-schema";
import type { CheckoutMode } from "@/features/settings/checkout-schema";
import { PIX_KEY_TYPE_LABELS } from "@/features/settings/pix-schema";
import { REQUESTED_PAYMENT_METHODS, REQUESTED_PAYMENT_METHOD_LABELS, type RequestedPaymentMethod } from "@/lib/whatsapp/message";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";

const STATE_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));

interface ShippingOption {
  id: string;
  name: string;
  price: number;
  estimatedDays: number | null;
}

/** Espelha ShippingQuoteResult (lib/shipping/provider.ts) — o Route Handler devolve o mesmo shape em JSON. */
type ShippingQuoteResponse =
  | { status: "disabled" }
  | { status: "unavailable" }
  | { status: "invalid_zip" }
  | { status: "ok"; options: ShippingOption[] };

type ShippingQuoteState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; result: ShippingQuoteResponse };

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="w-full rounded-lg bg-primary-container px-6 py-3.5 text-center font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? "Finalizando…" : label}
    </button>
  );
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Seção de entrega (Etapa 12) — dispara a cotação (`/api/shipping/quote`)
 * quando o CEP chega a 8 dígitos, mesmo campo já existente no endereço
 * (não duplica um segundo campo de CEP). O preço nunca é calculado aqui:
 * só exibido a partir do que o servidor devolveu — o valor final é
 * sempre revalidado de novo no servidor ao criar o pedido
 * (features/checkout/actions.ts / whatsapp-actions.ts). Compartilhada
 * pelos dois caminhos (pagar online / WhatsApp) — entrega não muda com o
 * canal de pagamento.
 */
function ShippingSection({
  quote,
  selectedId,
  onSelect,
}: {
  quote: ShippingQuoteState;
  selectedId: string | null;
  onSelect: (option: ShippingOption) => void;
}) {
  if (quote.kind === "idle") {
    return <p className="font-body text-body-sm text-on-surface-variant">Informe o CEP acima para calcular o frete.</p>;
  }
  if (quote.kind === "loading") {
    return <p className="font-body text-body-sm text-on-surface-variant">Calculando frete…</p>;
  }
  if (quote.kind === "error") {
    return (
      <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error">
        Não foi possível calcular o frete agora. Tente novamente em instantes.
      </p>
    );
  }

  const { result } = quote;

  if (result.status === "invalid_zip") {
    return <p className="font-body text-body-sm text-error">CEP inválido.</p>;
  }
  if (result.status === "disabled") {
    return (
      <p className="font-body text-body-sm text-on-surface-variant">
        Esta loja não configura frete pelo checkout — a entrega será combinada diretamente com o vendedor.
      </p>
    );
  }
  if (result.status === "unavailable") {
    return (
      <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error">
        Nenhuma opção de entrega disponível para este CEP no momento.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {result.options.map((option) => (
        <label
          className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors ${
            selectedId === option.id ? "border-primary/50 bg-primary/10" : "border-outline-variant/40 bg-surface-container-lowest"
          }`}
          key={option.id}
        >
          <span className="flex items-center gap-3">
            <input
              checked={selectedId === option.id}
              className="h-4 w-4 accent-primary"
              name="shippingOption"
              onChange={() => onSelect(option)}
              type="radio"
            />
            <span className="flex flex-col">
              <span className="font-body text-body-sm text-on-surface">{option.name}</span>
              {option.estimatedDays ? (
                <span className="font-body text-body-sm text-on-surface-variant">Até {option.estimatedDays} dia(s) útil(eis)</span>
              ) : null}
            </span>
          </span>
          <span className="font-label text-label-md text-on-surface">{formatShippingPrice(option.price)}</span>
        </label>
      ))}
    </div>
  );
}

function formatShippingPrice(price: number): string {
  return price === 0 ? "Grátis" : formatBRL(price);
}

const PAYMENT_METHOD_ICON: Record<RequestedPaymentMethod, string> = {
  pix: "bolt",
  cash: "payments",
  card: "credit_card",
};

/** Copia a chave PIX para a área de transferência — nenhum dado sai do navegador, é só um utilitário de UX. */
function CopyPixKeyButton({ pixKey }: { pixKey: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="flex items-center gap-2 rounded-lg border border-outline-variant/50 px-4 py-2 font-label text-label-md text-on-surface transition-colors hover:border-primary/50"
      onClick={() => {
        navigator.clipboard
          .writeText(pixKey)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => undefined);
      }}
      type="button"
    >
      <span className="material-symbols-outlined text-[18px]">{copied ? "check" : "content_copy"}</span>
      {copied ? "Chave copiada!" : "Copiar chave PIX"}
    </button>
  );
}

/**
 * Fase D2-B (revisão final). Bloco exibido quando PIX é escolhido — a
 * chave/nome do recebedor vêm sempre de `pixSettings` (prop resolvida no
 * servidor, `features/checkout/pix-settings.ts`), nunca digitados/
 * aceitos aqui. Se a loja não configurou PIX, avisa em vez de deixar o
 * cliente escolher uma opção sem chave nenhuma (prompt §32).
 */
function PixInstructions({ pixSettings, total }: { pixSettings: StorePixSettings | null; total: number }) {
  if (!pixSettings) {
    return (
      <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error">
        Esta loja ainda não configurou uma chave PIX. Escolha outra forma de pagamento.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-4">
      <p className="font-label text-label-md text-on-surface">💠 Pagamento via PIX</p>
      <div>
        <p className="font-body text-body-sm text-on-surface-variant">Total do pedido</p>
        <p className="font-headline text-headline-sm text-on-surface">{formatBRL(total)}</p>
      </div>
      <div>
        <p className="font-body text-body-sm text-on-surface-variant">
          Chave PIX da loja ({PIX_KEY_TYPE_LABELS[pixSettings.pixKeyType]}) — {pixSettings.recipientName}
        </p>
        <p className="break-all font-label text-label-md text-on-surface">{pixSettings.pixKey}</p>
      </div>
      <CopyPixKeyButton pixKey={pixSettings.pixKey} />
      <ol className="list-decimal space-y-1 pl-5 font-body text-body-sm text-on-surface-variant">
        <li>Copie a chave PIX.</li>
        <li>Faça o pagamento pelo aplicativo do seu banco.</li>
        <li>Clique em finalizar para enviar o pedido pelo WhatsApp.</li>
        <li>Anexe o comprovante diretamente na conversa do WhatsApp.</li>
      </ol>
    </div>
  );
}

/**
 * Fase D2-B (revisão final). "Precisa de troco?" — quando "Sim", exige o
 * valor que o cliente vai pagar (nunca o troco em si, calculado só para
 * exibição). A validação de verdade (cobre o total real) é sempre
 * refeita no servidor antes de criar o pedido — isto aqui é só UX.
 */
function CashChangeSection({ total, error }: { total: number; error?: string }) {
  const [wantsChange, setWantsChange] = useState<"no" | "yes">("no");
  const [changeFor, setChangeFor] = useState("");
  const changeForNumber = Number(changeFor.replace(",", "."));
  const changeDue = wantsChange === "yes" && changeForNumber > 0 ? changeForNumber - total : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-4">
      <p className="font-label text-label-md text-on-surface">Precisa de troco?</p>
      <div className="flex gap-4">
        <label className="flex items-center gap-2">
          <input
            checked={wantsChange === "no"}
            className="h-4 w-4 accent-primary"
            onChange={() => setWantsChange("no")}
            type="radio"
          />
          <span className="font-body text-body-sm text-on-surface">Não</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            checked={wantsChange === "yes"}
            className="h-4 w-4 accent-primary"
            onChange={() => setWantsChange("yes")}
            type="radio"
          />
          <span className="font-body text-body-sm text-on-surface">Sim</span>
        </label>
      </div>

      {wantsChange === "yes" ? (
        <div className="flex flex-col gap-2">
          <TextField
            error={error}
            icon="payments"
            id="cashChangeFor"
            label="Troco para quanto?"
            name="cashChangeFor"
            onChange={setChangeFor}
            placeholder="R$ 0,00"
          />
          {changeDue !== null && changeDue >= 0 ? (
            <p className="font-body text-body-sm text-on-surface-variant">
              Troco necessário: <strong className="text-on-surface">{formatBRL(changeDue)}</strong>
            </p>
          ) : null}
        </div>
      ) : (
        // name="cashChangeFor" só existe no DOM quando "Sim" é escolhido —
        // "Não" nunca envia nenhum valor de troco (o servidor trata a
        // ausência do campo como "sem troco", nunca lê um valor de um
        // campo desabilitado/oculto).
        <p className="font-body text-body-sm text-on-surface-variant">Você pagará o valor exato do pedido.</p>
      )}
    </div>
  );
}

/**
 * Fase D2-B (revisão final). Seleção obrigatória entre PIX/Dinheiro/
 * Cartão — nunca "combinar com a loja"/texto livre. Só aparece no
 * caminho WhatsApp.
 */
function PaymentPreferenceSection({
  pixSettings,
  total,
  paymentError,
  cashChangeError,
}: {
  pixSettings: StorePixSettings | null;
  total: number;
  paymentError?: string;
  cashChangeError?: string;
}) {
  const [selected, setSelected] = useState<RequestedPaymentMethod | null>(null);

  return (
    <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
      <h2 className="mb-4 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
        <span className="material-symbols-outlined text-primary">payments</span>
        Como deseja pagar?
      </h2>
      <div className="flex flex-col gap-2">
        {REQUESTED_PAYMENT_METHODS.map((method) => (
          <label
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3 transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/10"
            key={method}
          >
            <input
              className="h-4 w-4 accent-primary"
              name="paymentPreference"
              onChange={() => setSelected(method)}
              type="radio"
              value={method}
            />
            <span className="material-symbols-outlined text-[20px] text-primary">{PAYMENT_METHOD_ICON[method]}</span>
            <span className="font-body text-body-sm text-on-surface">{REQUESTED_PAYMENT_METHOD_LABELS[method]}</span>
          </label>
        ))}
      </div>
      {paymentError ? (
        <p className="mt-2 font-body text-body-sm text-error" role="alert">
          {paymentError}
        </p>
      ) : null}

      {selected === "pix" ? (
        <div className="mt-4">
          <PixInstructions pixSettings={pixSettings} total={total} />
        </div>
      ) : null}
      {selected === "cash" ? (
        <div className="mt-4">
          <CashChangeSection error={cashChangeError} total={total} />
        </div>
      ) : null}

      <p className="mt-3 font-body text-body-sm text-on-surface-variant">
        Essa é apenas uma preferência de pagamento. A confirmação será combinada diretamente com a loja pelo WhatsApp.
      </p>
    </section>
  );
}

/** Alterna entre os dois caminhos, só quando os dois estão disponíveis (checkout_mode='both' com Mercado Pago conectado). */
function PathToggle({ selected, onSelect }: { selected: "online" | "whatsapp"; onSelect: (path: "online" | "whatsapp") => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {(
        [
          { path: "online" as const, icon: "credit_card", title: "Pagar online", description: "Finalize o pagamento agora, direto na loja." },
          { path: "whatsapp" as const, icon: "chat", title: "Pedir pelo WhatsApp", description: "Envie seu pedido e combine o pagamento com a loja." },
        ]
      ).map((option) => (
        <button
          className={`flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-colors ${
            selected === option.path ? "border-primary/50 bg-primary/10" : "border-outline-variant/40 bg-surface-container-lowest"
          }`}
          key={option.path}
          onClick={() => onSelect(option.path)}
          type="button"
        >
          <span className="flex items-center gap-2 font-label text-label-md text-on-surface">
            <span className="material-symbols-outlined text-[20px] text-primary">{option.icon}</span>
            {option.title}
          </span>
          <span className="font-body text-body-sm text-on-surface-variant">{option.description}</span>
        </button>
      ))}
    </div>
  );
}

/** Formulário único com seções (não um wizard) — mesmo padrão já usado em product-form.tsx (painel), não um design novo (prompt Etapa 10 §3/§18). */
export function CheckoutForm({
  storeSlug,
  items,
  subtotal,
  hasUnavailableItems,
  checkoutMode,
  gatewayConnected,
  pixSettings,
}: {
  storeSlug: string;
  items: OrderSummaryLine[];
  subtotal: number;
  hasUnavailableItems: boolean;
  checkoutMode: CheckoutMode;
  gatewayConnected: boolean;
  pixSettings: StorePixSettings | null;
}) {
  // Fase D2-B — o que a loja realmente oferece AGORA (nunca só
  // checkout_mode isolado: `both` sem Mercado Pago conectado só oferece
  // WhatsApp, exatamente como a página de checkout já decidiu ao não
  // bloquear a página inteira). Decisão espelhada aqui só para UI — a
  // autoridade real está nas Actions (createOrderAction/
  // createOrderForWhatsappAction), que revalidam tudo de novo no servidor.
  const onlineAllowed = checkoutMode !== "whatsapp" && (checkoutMode === "vexo" || gatewayConnected);
  const whatsappAllowed = checkoutMode !== "vexo";
  const showToggle = onlineAllowed && whatsappAllowed;

  const [selectedPath, setSelectedPath] = useState<"online" | "whatsapp">(onlineAllowed ? "online" : "whatsapp");

  const onlineAction = createOrderAction.bind(null, storeSlug);
  const [onlineState, onlineFormAction] = useActionState(onlineAction, initialCheckoutState);

  const whatsappAction = createOrderForWhatsappAction.bind(null, storeSlug);
  const [whatsappState, whatsappFormAction] = useActionState(whatsappAction, initialCheckoutWhatsappState);

  const activeState = selectedPath === "online" ? onlineState : whatsappState;
  const activeFormAction = selectedPath === "online" ? onlineFormAction : whatsappFormAction;

  const [quote, setQuote] = useState<ShippingQuoteState>({ kind: "idle" });
  const [selectedOption, setSelectedOption] = useState<ShippingOption | null>(null);
  const requestZipRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      requestZipRef.current = null;
    };
  }, []);

  function handleZipChange(rawValue: string) {
    const digits = rawValue.replace(/\D/g, "");
    setSelectedOption(null);

    if (digits.length !== 8) {
      requestZipRef.current = null;
      setQuote({ kind: "idle" });
      return;
    }

    requestZipRef.current = digits;
    setQuote({ kind: "loading" });

    fetch(`/api/shipping/quote?slug=${encodeURIComponent(storeSlug)}&zip=${digits}`)
      .then((res) => res.json() as Promise<ShippingQuoteResponse>)
      .then((result) => {
        if (requestZipRef.current !== digits) return; // resposta de um CEP já substituído — ignora (evita corrida CEP A/B).
        setQuote({ kind: "loaded", result });
        if (result.status === "ok" && result.options.length > 0) {
          setSelectedOption(result.options[0]!);
        }
      })
      .catch(() => {
        if (requestZipRef.current !== digits) return;
        setQuote({ kind: "error" });
      });
  }

  const shippingBlocksSubmit =
    quote.kind === "loading" ||
    (quote.kind === "loaded" &&
      (quote.result.status === "unavailable" || (quote.result.status === "ok" && !selectedOption)));
  const shippingTotal = selectedOption?.price ?? 0;
  const total = subtotal + shippingTotal;
  const submitDisabled = hasUnavailableItems || shippingBlocksSubmit;

  return (
    <form action={activeFormAction} className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        {showToggle ? <PathToggle onSelect={setSelectedPath} selected={selectedPath} /> : null}

        <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
          <h2 className="mb-4 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
            <span className="material-symbols-outlined text-primary">person</span>
            Identificação
          </h2>
          <div className="flex flex-col gap-4">
            <TextField
              autoComplete="name"
              error={activeState.fieldErrors?.customerName}
              icon="person"
              id="customerName"
              label="Nome completo"
              name="customerName"
              placeholder="Seu nome completo"
            />
            <TextField
              autoComplete="email"
              error={activeState.fieldErrors?.customerEmail}
              icon="mail"
              id="customerEmail"
              label="E-mail"
              name="customerEmail"
              placeholder="voce@email.com"
              type="email"
            />
            <TextField
              autoComplete="tel"
              error={activeState.fieldErrors?.customerPhone}
              icon="call"
              id="customerPhone"
              label="Telefone / WhatsApp"
              name="customerPhone"
              placeholder="(11) 91234-5678"
              type="tel"
            />
          </div>
        </section>

        <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
          <h2 className="mb-4 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
            <span className="material-symbols-outlined text-primary">local_shipping</span>
            Endereço de entrega
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              autoComplete="postal-code"
              error={activeState.fieldErrors?.zip}
              icon="pin_drop"
              id="zip"
              label="CEP"
              name="zip"
              onChange={handleZipChange}
              placeholder="00000-000"
            />
            <TextField
              autoComplete="address-line2"
              error={activeState.fieldErrors?.number}
              icon="tag"
              id="number"
              label="Número"
              name="number"
              placeholder="123"
            />
            <div className="sm:col-span-2">
              <TextField
                autoComplete="address-line1"
                error={activeState.fieldErrors?.street}
                icon="signpost"
                id="street"
                label="Endereço"
                name="street"
                placeholder="Rua, avenida…"
              />
            </div>
            <div className="sm:col-span-2">
              <TextField
                error={activeState.fieldErrors?.complement}
                icon="apartment"
                id="complement"
                label="Complemento (opcional)"
                name="complement"
                placeholder="Apto, bloco…"
              />
            </div>
            <TextField
              error={activeState.fieldErrors?.neighborhood}
              icon="location_city"
              id="neighborhood"
              label="Bairro"
              name="neighborhood"
              placeholder="Bairro"
            />
            <TextField
              autoComplete="address-level2"
              error={activeState.fieldErrors?.city}
              icon="location_city"
              id="city"
              label="Cidade"
              name="city"
              placeholder="Cidade"
            />
            <SelectField
              defaultValue=""
              error={activeState.fieldErrors?.state}
              id="state"
              label="Estado"
              name="state"
              options={STATE_OPTIONS}
              placeholder="UF"
            />
          </div>
        </section>

        <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
          <h2 className="mb-4 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
            <span className="material-symbols-outlined text-primary">local_shipping</span>
            Entrega
          </h2>
          <ShippingSection onSelect={setSelectedOption} quote={quote} selectedId={selectedOption?.id ?? null} />
        </section>

        {selectedOption ? (
          <>
            <input name="shippingMethodId" type="hidden" value={selectedOption.id} />
            <input name="shippingPrice" type="hidden" value={selectedOption.price} />
          </>
        ) : null}

        {selectedPath === "whatsapp" ? (
          <PaymentPreferenceSection
            cashChangeError={whatsappState.fieldErrors?.cashChangeFor}
            paymentError={whatsappState.fieldErrors?.paymentPreference}
            pixSettings={pixSettings}
            total={total}
          />
        ) : null}

        {activeState.status === "error" && activeState.message ? (
          <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error" role="alert">
            {activeState.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <OrderSummary discountTotal={0} items={items} shippingTotal={shippingTotal} subtotal={subtotal} total={total} />

        {hasUnavailableItems ? (
          <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error">
            Alguns produtos do seu carrinho não estão mais disponíveis.{" "}
            <Link className="underline" href={`/loja/${storeSlug}/carrinho`}>
              Volte ao carrinho
            </Link>{" "}
            para removê-los antes de continuar.
          </p>
        ) : null}

        <SubmitButton disabled={submitDisabled} label={selectedPath === "whatsapp" ? "Continuar no WhatsApp" : "Finalizar pedido"} />
      </div>
    </form>
  );
}
