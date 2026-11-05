import { expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

function loopback(value: string | undefined) {
  if (!value || process.env.E2E_ISOLATED_SUPABASE !== "1" || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname)) throw new Error("Auth/email fixtures require isolated loopback endpoints.");
  return value.replace(/\/$/, "");
}
export function localAuthAdmin() {
  return createClient(loopback(process.env.NEXT_PUBLIC_SUPABASE_URL), process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function localAuthEmail(email: string, excludeId?: string) {
  const origin = loopback(process.env.E2E_MAIL_API_URL);
  let id: string | undefined;
  await expect.poll(async () => {
    const result = await fetch(`${origin}/api/v1/messages`).then((response) => response.json()) as { messages: { ID: string; To: { Address: string }[] }[] };
    id = result.messages.find((message) => message.ID !== excludeId && message.To.some((recipient) => recipient.Address === email))?.ID;
    return Boolean(id);
  }, { timeout: 20_000, message: "Synthetic Auth email must arrive in local Mailpit" }).toBe(true);
  const message = await fetch(`${origin}/api/v1/message/${id}`).then((response) => response.json()) as { HTML: string };
  const links = [...message.HTML.matchAll(/href=["']([^"']+)["']/g)].map((match) => match[1]!.replaceAll("&amp;", "&"));
  const link = links.find((value) => { try { return new URL(value).pathname === "/auth/v1/verify"; } catch { return false; } });
  if (!link) throw new Error("Synthetic email has no Auth verification link; message body withheld.");
  const target = new URL(link);
  const api = new URL(loopback(process.env.NEXT_PUBLIC_SUPABASE_URL));
  if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.port !== api.port) throw new Error("Email verification link escaped the local Auth origin.");
  const redirect = target.searchParams.get("redirect_to");
  if (redirect && new URL(redirect).origin !== "http://127.0.0.1:3100") throw new Error("Auth email redirect escaped the disposable app.");
  return { id: id!, link };
}

export function syntheticDocument(bytes: Uint8Array) {
  const digits = Array.from(bytes.slice(0, 9), (value) => value % 10);
  for (const length of [9, 10]) {
    const remainder = digits.reduce((sum, digit, index) => sum + digit * (length + 1 - index), 0) % 11;
    digits.push(remainder < 2 ? 0 : 11 - remainder);
  }
  return digits.join("");
}
