"use client";

import { useFormStatus } from "react-dom";

/** Primary "AI action" gradient button (Stitch: ai-glow + gradient-to-r). */
export function SubmitButton({
  children,
  pendingLabel,
}: {
  children: React.ReactNode;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className="ai-glow flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#7C3AED] to-[#3B82F6] py-3 font-body text-body-md font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? (
        pendingLabel
      ) : (
        <>
          <span
            className="material-symbols-outlined text-sm"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            auto_awesome
          </span>
          {children}
        </>
      )}
    </button>
  );
}
