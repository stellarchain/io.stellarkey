import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputRoot = path.join(projectRoot, "out");
const templatePath = path.join(outputRoot, "_headers");

export function collectInlineScriptHashes(htmlDocuments) {
  const documents = Array.isArray(htmlDocuments) ? htmlDocuments : [htmlDocuments];
  const hashes = documents.flatMap((html) =>
    [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter(Boolean)
      .map((source) => `sha256-${createHash("sha256").update(source).digest("base64")}`),
  );
  return [...new Set(hashes)].sort();
}

export function renderStaticHeaders({ template, htmlDocuments }) {
  if (!template.includes("__SCRIPT_HASHES__")) {
    throw new Error("Static header template is missing the script-hash placeholder.");
  }
  const hashes = collectInlineScriptHashes(htmlDocuments);
  if (hashes.length === 0) {
    throw new Error("Static export contains no inline bootstrap scripts to authorize.");
  }
  return template.replace("__SCRIPT_HASHES__", hashes.map((hash) => `'${hash}'`).join(" "));
}

export async function readExportedHtml(directory = outputRoot) {
  const documents = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".html")) {
        documents.push(await readFile(target, "utf8"));
      }
    }
  }
  await visit(directory);
  return documents;
}

export async function generateStaticHeaders() {
  const [template, htmlDocuments] = await Promise.all([
    readFile(templatePath, "utf8"),
    readExportedHtml(),
  ]);
  const rendered = renderStaticHeaders({ template, htmlDocuments });
  await writeFile(templatePath, rendered);
  return collectInlineScriptHashes(htmlDocuments).length;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const count = await generateStaticHeaders();
  process.stdout.write(`Authorized ${count} inline script hashes across the static release.\n`);
}
