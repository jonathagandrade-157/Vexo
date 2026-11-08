"use client";
import { useActionState } from "react";
import Link from "next/link";
import { TextField } from "@/components/ui/text-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { finishPendingSignupAction, resendConfirmationAction } from "@/features/auth/actions";
import { initialResetPasswordRequestState, initialSignUpState } from "@/features/auth/schema";

export function ConfirmationForm({ confirmed, invalidLink }: { confirmed: boolean; invalidLink: boolean }) {
  const [resend, resendAction] = useActionState(resendConfirmationAction, initialResetPasswordRequestState);
  const [finish, finishAction] = useActionState(finishPendingSignupAction, initialSignUpState);
  return <div className="space-y-6 rounded-xl border border-surface-container-highest bg-surface-container-lowest p-6 md:p-8">
    {invalidLink ? <p role="alert" className="text-error">Este link de confirmação é inválido, expirou ou já foi utilizado. Solicite um novo link.</p> :
      <p>Abra o link enviado ao seu e-mail para confirmar a conta. O período de teste começa depois da confirmação.</p>}
    {confirmed ? <form action={finishAction} className="space-y-4">
      <p>Seu e-mail está confirmado. Você pode concluir o cadastro da loja.</p>
      {finish.message ? <p role="alert">{finish.message}</p> : null}
      <SubmitButton pendingLabel="Concluindo cadastro…">Concluir cadastro</SubmitButton>
    </form> : null}
    <form action={resendAction} className="space-y-4" noValidate>
      <TextField id="confirmation-email" name="email" label="E-mail" icon="mail" type="email" autoComplete="email" />
      <SubmitButton pendingLabel="Solicitando…">Reenviar confirmação</SubmitButton>
      {resend.message ? <p role={resend.status === "error" ? "alert" : "status"}>{resend.message}</p> : null}
    </form>
    <p className="font-body text-body-sm text-on-surface-variant">Se abriu o link em outro navegador, entre na conta confirmada e finalize os dados da loja.</p>
    <div className="flex flex-wrap gap-5 text-primary underline"><Link href="/login">Entrar na conta</Link><Link href="/cadastro">Finalizar cadastro da loja</Link></div>
  </div>;
}
