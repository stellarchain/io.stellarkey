import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputRoot = path.join(projectRoot, "out");
const templatePath = path.join(outputRoot, "_headers");
const documentPolicyPath = path.join(projectRoot, "scripts", "static-document-csp.txt");

export const CLOUDFLARE_HEADER_LINE_LIMIT = 2_000;
const DOCUMENT_CSP_MARKER = "data-stellarkey-csp";

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

function escapeHtmlAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

export function renderDocumentWithCsp({ html, policyTemplate }) {
  if (!policyTemplate.includes("__SCRIPT_HASHES__")) {
    throw new Error("Document CSP template is missing the script-hash placeholder.");
  }
  if (/\bframe-ancestors\b/i.test(policyTemplate)) {
    throw new Error("frame-ancestors must be enforced by the response header, not a CSP meta tag.");
  }

  const hashes = collectInlineScriptHashes(html);
  if (hashes.length === 0) {
    throw new Error("Static document contains no inline bootstrap scripts to authorize.");
  }

  const policy = policyTemplate
    .trim()
    .replace("__SCRIPT_HASHES__", hashes.map((hash) => `'${hash}'`).join(" "));
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(policy)}" ${DOCUMENT_CSP_MARKER}="">`;
  const withoutGeneratedPolicy = html.replace(
    new RegExp(`<meta\\s+[^>]*${DOCUMENT_CSP_MARKER}(?:=[^\\s>]*)?[^>]*>`, "gi"),
    "",
  );

  if (!/<head(?:\s[^>]*)?>/i.test(withoutGeneratedPolicy)) {
    throw new Error("Static document is missing a head element for its CSP meta tag.");
  }

  return withoutGeneratedPolicy.replace(
    /<head(?:\s[^>]*)?>/i,
    (head) => `${head}${meta}`,
  );
}

export function renderStaticHeaders({ template }) {
  if (template.includes("__SCRIPT_HASHES__")) {
    throw new Error("Static response headers must not contain the script-hash placeholder.");
  }
  const oversizedLine = template
    .split(/\r?\n/)
    .find((line) => line.length > CLOUDFLARE_HEADER_LINE_LIMIT);
  if (oversizedLine) {
    throw new Error(
      `Cloudflare Pages _headers lines must not exceed ${CLOUDFLARE_HEADER_LINE_LIMIT.toLocaleString("en-US")} characters.`,
    );
  }
  return template;
}

export async function readExportedHtml(directory = outputRoot) {
  const documents = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".html")) {
        documents.push({ path: target, html: await readFile(target, "utf8") });
      }
    }
  }
  await visit(directory);
  return documents;
}

export async function generateStaticHeaders() {
  const [template, policyTemplate, htmlDocuments] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(documentPolicyPath, "utf8"),
    readExportedHtml(),
  ]);
  const renderedHeaders = renderStaticHeaders({ template });
  let hashCount = 0;
  await Promise.all(
    htmlDocuments.map(async (document) => {
      hashCount += collectInlineScriptHashes(document.html).length;
      const renderedDocument = renderDocumentWithCsp({
        html: document.html,
        policyTemplate,
      });
      await writeFile(document.path, renderedDocument);
    }),
  );
  await writeFile(templatePath, renderedHeaders);
  return hashCount;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const count = await generateStaticHeaders();
  process.stdout.write(`Authorized ${count} document-scoped inline script hashes across the static release.\n`);
}
