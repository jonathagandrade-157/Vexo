import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { decryptStream, encryptStream, hashFile } from "./core.mjs";

export function validateRootKey(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw new Error("Unexpected project root-key format; raw response withheld.");
  return value.toLowerCase();
}

export async function sealRootKey(rootKey, projectRef, recipient, destination) {
  const key = validateRootKey(rootKey);
  const payload = { projectRef, rootKey: key };
  const result = await encryptStream(Readable.from([JSON.stringify(payload)]), destination, recipient);
  return { projectRef, rootKeySha256: createHash("sha256").update(key).digest("hex"),
    encryptedKeySha256: result.ciphertextSha256, recipient, createdAt: new Date().toISOString(), rootKeyEscrowVerified: false };
}

export async function verifyEscrowCopy(path, identity, receipt) {
  if (await hashFile(path) !== receipt.encryptedKeySha256) throw new Error("Escrow ciphertext differs from the original encrypted export.");
  const chunks = [];
  let bytes = 0;
  const sink = new Writable({ write(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > 4096) return callback(new Error("Invalid root-key escrow size."));
    chunks.push(chunk); callback();
  } });
  await decryptStream(path, identity, sink);
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const key = validateRootKey(payload.rootKey);
  if (payload.projectRef !== receipt.projectRef || createHash("sha256").update(key).digest("hex") !== receipt.rootKeySha256) {
    throw new Error("Escrow copy cannot recover the approved project's root key.");
  }
  return { ...receipt, rootKeyEscrowVerified: true };
}

async function main() {
  const env = process.env;
  if (!process.argv.includes("--execute")) {
    console.log(JSON.stringify({ mode: "plan-only", requiredNames: ["BACKUP_SOURCE_PROJECT_REF", "BACKUP_MANAGEMENT_TOKEN", "BACKUP_VAULT_RECIPIENT", "BACKUP_ROOT_ESCROW_DIR", "BACKUP_APPROVED_VAULT_EXPORT", "BACKUP_APPROVAL_REFERENCE"],
      operation: "GET project root key only after specific approval; encrypt with a separate recipient; verify the saved vault copy on the custodian's device" }));
    return;
  }
  const projectRef = env.BACKUP_SOURCE_PROJECT_REF;
  if (!/^[a-z]{20}$/.test(projectRef ?? "") || env.BACKUP_APPROVED_VAULT_EXPORT !== projectRef || !env.BACKUP_APPROVAL_REFERENCE ||
      !env.BACKUP_MANAGEMENT_TOKEN || !env.BACKUP_ROOT_ESCROW_DIR || !env.BACKUP_VAULT_RECIPIENT) {
    throw new Error("Project-specific root-key export approval and separate escrow configuration required.");
  }
  const directory = resolve(env.BACKUP_ROOT_ESCROW_DIR);
  if (!directory.startsWith(resolve(".")) && !/[\\/]onedrive[\\/]/i.test(directory)) {
    process.umask(0o077);
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } else throw new Error("Root-key escrow staging must be outside Git and synchronized workspaces.");
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/pgsodium`, {
    headers: { Authorization: `Bearer ${env.BACKUP_MANAGEMENT_TOKEN}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Approved root-key retrieval failed; provider response withheld.");
  const rootKey = validateRootKey(await response.json());
  const filename = `vault-root-${projectRef}-${Date.now()}.age`;
  const receipt = await sealRootKey(rootKey, projectRef, env.BACKUP_VAULT_RECIPIENT, join(directory, filename));
  await writeFile(join(directory, `${filename}.receipt.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ projectRef, encrypted: true, escrowVerified: false,
    next: "Store the encrypted file in the separately approved vault, then verify that saved copy with the custodian's private identity before exporting application data." }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Vault escrow failed; root key and provider output withheld."); process.exitCode = 1; });
}
