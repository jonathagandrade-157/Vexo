import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";
import ts from "typescript";

// Reuse the existing VEXO icon, not a second drawing of the brand.
// The browser may request /favicon.ico before streamed icon metadata.
const root = new URL("../", import.meta.url);
const output = new URL("test-results/", root);
await mkdir(output, { recursive: true });
const temporaryModule = new URL(`favicon-generator-${process.pid}.mjs`, output);
const source = await readFile(new URL("app/icon.tsx", root), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('from "next/og"', 'from "next/og.js"'); // Node ESM requires the extension.

try {
  await writeFile(temporaryModule, compiled);
  const { default: renderIcon } = await import(pathToFileURL(fileURLToPath(temporaryModule)).href);
  const png = Buffer.from(await renderIcon().arrayBuffer());
  const sizes = [16, 32, 48, 256];
  const images = await Promise.all(sizes.map((size) => sharp(png).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2); // ICO, not CUR
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] === 256 ? 0 : sizes[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  }
  await writeFile(new URL("app/favicon.ico", root), Buffer.concat([header, ...images]));
  await writeFile(new URL("favicon-preview.png", output), images.at(-1));
  console.log("Generated app/favicon.ico from app/icon.tsx (16, 32, 48 and 256 px).");
} finally {
  await unlink(temporaryModule);
}
