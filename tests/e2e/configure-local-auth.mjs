import { readFile, writeFile } from "node:fs/promises";
if (process.env.CI !== "true" || process.env.VEXO_SYNTHETIC_AUTH_ONLY !== "1") throw new Error("Auth configuration changes require the disposable CI checkout.");
const path = new URL("../../supabase/config.toml", import.meta.url);
let source = await readFile(path, "utf8");
function replaceSection(name, transform) {
  const section = new RegExp(`(\\[${name.replaceAll(".", "\\.")}\\]\\r?\\n)([\\s\\S]*?)(?=\\r?\\n\\[|$)`);
  if (!section.test(source)) throw new Error("Expected local Auth configuration section not found.");
  source = source.replace(section, (_match, heading, body) => heading + transform(body));
}
replaceSection("auth", (body) => body.replace(/^site_url = .*$/m, 'site_url = "http://127.0.0.1:3100"').replace(/^additional_redirect_urls = .*$/m, 'additional_redirect_urls = ["http://127.0.0.1:3100/**"]'));
replaceSection("auth.email", (body) => body.replace(/^enable_confirmations = false$/m, "enable_confirmations = true"));
await writeFile(path, source);
console.log("Disposable Auth configured with email confirmation; delivery stays in local Mailpit.");
