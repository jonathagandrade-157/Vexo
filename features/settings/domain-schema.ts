import { z } from "zod";

import { getPublicEnv } from "@/lib/env";

/**
 * D17.2 — formato de hostname (RFC 1123, rótulos separados por ponto),
 * não posse do domínio: aceita qualquer string com pelo menos 2 rótulos
 * (ex.: "minhaloja.com.br"), rejeita por construção qualquer coisa com
 * protocolo (http://), caminho (/x), query (?x), fragment (#x) ou espaço
 * interno — nenhum desses caracteres pertence à classe [a-z0-9.-] aceita
 * pelo regex. Verificação de posse real (DNS/TXT/CNAME) é D17.3, fora do
 * escopo aqui — este schema só valida o FORMATO do que o lojista digitou.
 */
const HOSTNAME_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const MAX_DOMAIN_LENGTH = 253;

export const customDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(1, "Informe um domínio.")
    .transform((value, ctx) => {
      const normalized = value.toLowerCase();
      if (normalized.length > MAX_DOMAIN_LENGTH || !HOSTNAME_REGEX.test(normalized)) {
        ctx.addIssue({
          code: "custom",
          message: "Informe um domínio válido, sem http(s):// nem caminho (ex.: minhaloja.com.br).",
        });
        return z.NEVER;
      }
      return normalized;
    }),
});

export type CustomDomainInput = z.infer<typeof customDomainSchema>;

export interface DomainActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof CustomDomainInput, string>>;
}

export const initialDomainActionState: DomainActionState = { status: "idle" };

/**
 * Impede que o lojista cadastre um domínio que já pertence à própria
 * infraestrutura da VEXO — nunca uma lista inventada: deriva sempre da
 * configuração real já existente (`getPublicEnv()`), nunca uma string
 * fixa de produção hardcoded.
 *
 * - `NEXT_PUBLIC_SITE_URL`: o domínio que a própria aplicação usa hoje
 *   (produção, staging, ou dev — o que estiver configurado neste
 *   ambiente).
 * - `NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX`: o sufixo reservado para o
 *   subdomínio padrão de cada loja (arquitetura §17/§23) — o próprio
 *   valor, e qualquer subdomínio dele, nunca pode virar "domínio
 *   personalizado" de um tenant (colidiria com o próprio namespace da
 *   VEXO).
 */
export function isReservedDomain(domain: string): boolean {
  const { NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX } = getPublicEnv();

  let siteHost = "";
  try {
    siteHost = new URL(NEXT_PUBLIC_SITE_URL).hostname.toLowerCase();
  } catch {
    siteHost = "";
  }
  const suffix = NEXT_PUBLIC_STOREFRONT_DOMAIN_SUFFIX.toLowerCase();

  return (siteHost !== "" && domain === siteHost) || domain === suffix || domain.endsWith(`.${suffix}`);
}
