"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { OrderSummary, type OrderSummaryLine } from "@/components/storefront/order-summary";
import { createOrderAction } from "@/features/checkout/actions";
import { BRAZILIAN_STATES, initialCheckoutState } from "@/features/checkout/schema";
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

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="w-full rounded-lg bg-primary-container px-6 py-3.5 text-center font-label text-label-md text-on-primary-container transition-colors hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? "Finalizando…" : "Finalizar pedido"}
    </button>
  );
}

function formatShippingPrice(price: number): string {
  return price === 0 ? "Grátis" : price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Seção de entrega (Etapa 12) — dispara a cotação (`/api/shipping/quote`)
 * quando o CEP chega a 8 dígitos, mesmo campo já existente no endereço
 * (não duplica um segundo campo de CEP). O preço nunca é calculado aqui:
 * só exibido a partir do que o servidor devolveu — o valor final é
 * sempre revalidado de novo no servidor ao criar o pedido
 * (features/checkout/actions.ts).
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

/** Formulário único com seções (não um wizard) — mesmo padrão já usado em product-form.tsx (painel), não um design novo (prompt Etapa 10 §3/§18). */
export function CheckoutForm({
  storeSlug,
  items,
  subtotal,
  hasUnavailableItems,
}: {
  storeSlug: string;
  items: OrderSummaryLine[];
  subtotal: number;
  hasUnavailableItems: boolean;
}) {
  const action = createOrderAction.bind(null, storeSlug);
  const [state, formAction] = useActionState(action, initialCheckoutState);

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
    <form action={formAction} className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4 md:p-6">
          <h2 className="mb-4 flex items-center gap-2 font-headline text-headline-sm text-on-surface">
            <span className="material-symbols-outlined text-primary">person</span>
            Identificação
          </h2>
          <div className="flex flex-col gap-4">
            <TextField
              autoComplete="name"
              error={state.fieldErrors?.customerName}
              icon="person"
              id="customerName"
              label="Nome completo"
              name="customerName"
              placeholder="Seu nome completo"
            />
            <TextField
              autoComplete="email"
              error={state.fieldErrors?.customerEmail}
              icon="mail"
              id="customerEmail"
              label="E-mail"
              name="customerEmail"
              placeholder="voce@email.com"
              type="email"
            />
            <TextField
              autoComplete="tel"
              error={state.fieldErrors?.customerPhone}
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
              error={state.fieldErrors?.zip}
              icon="pin_drop"
              id="zip"
              label="CEP"
              name="zip"
              onChange={handleZipChange}
              placeholder="00000-000"
            />
            <TextField
              autoComplete="address-line2"
              error={state.fieldErrors?.number}
              icon="tag"
              id="number"
              label="Número"
              name="number"
              placeholder="123"
            />
            <div className="sm:col-span-2">
              <TextField
                autoComplete="address-line1"
                error={state.fieldErrors?.street}
                icon="signpost"
                id="street"
                label="Endereço"
                name="street"
                placeholder="Rua, avenida…"
              />
            </div>
            <div className="sm:col-span-2">
              <TextField
                error={state.fieldErrors?.complement}
                icon="apartment"
                id="complement"
                label="Complemento (opcional)"
                name="complement"
                placeholder="Apto, bloco…"
              />
            </div>
            <TextField
              error={state.fieldErrors?.neighborhood}
              icon="location_city"
              id="neighborhood"
              label="Bairro"
              name="neighborhood"
              placeholder="Bairro"
            />
            <TextField
              autoComplete="address-level2"
              error={state.fieldErrors?.city}
              icon="location_city"
              id="city"
              label="Cidade"
              name="city"
              placeholder="Cidade"
            />
            <SelectField
              defaultValue=""
              error={state.fieldErrors?.state}
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

        {state.status === "error" && state.message ? (
          <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error" role="alert">
            {state.message}
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

        <SubmitButton disabled={submitDisabled} />
      </div>
    </form>
  );
}
