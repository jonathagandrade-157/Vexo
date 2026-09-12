/**
 * Single source of truth for the Clínica Tajy WhatsApp number and message
 * links — every CTA on the /tajy landing page routes through
 * `createWhatsAppLink` instead of hardcoding `wa.me/...` in components.
 */
export const WHATSAPP_NUMBER = "5511987280910";

/**
 * The web developer's own WhatsApp, for the footer credit link. Left
 * empty on purpose — the real number was never provided, and the task
 * explicitly forbids inventing it. Set this to enable the link; until
 * then the footer renders the credit as plain text instead of a link.
 */
export const DEVELOPER_WHATSAPP = "";

export function createWhatsAppLink(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export const WHATSAPP_MESSAGES = {
  general: "Olá! Gostaria de agendar uma avaliação na Clínica Tajy.",
  about: "Olá! Gostaria de conhecer melhor a Clínica Tajy.",
  results: "Olá! Gostei dos resultados e quero saber mais sobre os tratamentos da Clínica Tajy.",
  treatment: (name: string) => `Olá! Gostaria de saber mais sobre ${name}.`,
} as const;
