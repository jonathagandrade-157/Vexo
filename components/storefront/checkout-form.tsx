"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { OrderSummary, type OrderSummaryLine } from "@/components/storefront/order-summary";
import { createOrderAction } from "@/features/checkout/actions";
import { BRAZILIAN_STATES, initialCheckoutState } from "@/features/checkout/schema";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";

const STATE_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));

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

        {state.status === "error" && state.message ? (
          <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error" role="alert">
            {state.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <OrderSummary discountTotal={0} items={items} shippingTotal={0} subtotal={subtotal} total={subtotal} />

        {hasUnavailableItems ? (
          <p className="rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 font-body text-body-sm text-error">
            Alguns produtos do seu carrinho não estão mais disponíveis.{" "}
            <Link className="underline" href={`/loja/${storeSlug}/carrinho`}>
              Volte ao carrinho
            </Link>{" "}
            para removê-los antes de continuar.
          </p>
        ) : null}

        <SubmitButton disabled={hasUnavailableItems} />
      </div>
    </form>
  );
}
