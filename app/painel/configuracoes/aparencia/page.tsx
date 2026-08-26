import { redirect } from "next/navigation";

/**
 * Sprint 1 — Fase B3 §15. "Aparência" deixou de ser uma sub-rota de
 * Configurações e virou uma área própria do painel (`/painel/aparencia`,
 * item de nav em `components/painel/nav-items.ts`). Esta rota antiga
 * continua existindo só como redirecionamento — nenhum link/favorito
 * apontando para ela deveria quebrar (§15: "nenhuma rota existente deve
 * ficar morta").
 */
export default function ConfiguracoesAparenciaRedirect() {
  redirect("/painel/aparencia");
}
