import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputRoot = path.join(projectRoot, "out");
const html = await readFile(path.join(outputRoot, "index.html"), "utf8");
const templatePath = path.join(outputRoot, "_headers");
const template = await readFile(templatePath, "utf8");

const hashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter(Boolean)
  .map((source) => `sha256-${createHash("sha256").update(source).digest("base64")}`);
const uniqueHashes = [...new Set(hashes)].sort();

if (!template.includes("__SCRIPT_HASHES__")) {
  throw new Error("Static header template is missing the script-hash placeholder.");
}
if (uniqueHashes.length === 0) {
  throw new Error("Static export contains no inline bootstrap scripts to authorize.");
}

await writeFile(
  templatePath,
  template.replace("__SCRIPT_HASHES__", uniqueHashes.map((hash) => `'${hash}'`).join(" ")),
);

process.stdout.write(`Authorized ${uniqueHashes.length} inline bootstrap script hashes.\n`);
