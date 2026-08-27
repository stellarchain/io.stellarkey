import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputRoot = path.join(projectRoot, "out");
const templatePath = path.join(projectRoot, "public", "sw.js");
const BUILD_ORIGIN = "https://polaris.invalid";

export const BASE_SHELL_PATHS = Object.freeze([
  "/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-icon.png",
  "/apple-touch-icon.png",
]);

function isShellPath(url) {
  return url.origin === BUILD_ORIGIN && (
    BASE_SHELL_PATHS.includes(url.pathname) || url.pathname.startsWith("/_next/static/")
  );
}

/** Exact HTML resources plus install metadata; external services are excluded. */
export function discoverShellPaths(html) {
  const paths = new Set(BASE_SHELL_PATHS);
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = new URL(match[1], BUILD_ORIGIN);
    if (isShellPath(url)) paths.add(`${url.pathname}${url.search}`);
  }
  return [...paths];
}

export function renderServiceWorker({ template, html, revision }) {
  if (!/^[a-zA-Z0-9._-]+$/.test(revision)) {
    throw new Error("Service-worker revision contains unsupported characters.");
  }
  const paths = discoverShellPaths(html);
  const revisionLine = /^const BUILD_REVISION = .*; \/\/ @generated-revision$/m;
  const precacheLine = /^const PRECACHE_PATHS = .*; \/\/ @generated-precache$/m;
  if (!revisionLine.test(template) || !precacheLine.test(template)) {
    throw new Error("Service-worker template is missing its generation markers.");
  }
  return template
    .replace(revisionLine, `const BUILD_REVISION = ${JSON.stringify(revision)}; // @generated-revision`)
    .replace(
      precacheLine,
      `const PRECACHE_PATHS = new Set(${JSON.stringify(paths)}); // @generated-precache`,
    );
}

function outputFileForShellPath(shellPath) {
  const url = new URL(shellPath, BUILD_ORIGIN);
  return url.pathname === "/"
    ? path.join(outputRoot, "index.html")
    : path.join(outputRoot, decodeURIComponent(url.pathname.slice(1)));
}

async function buildRevision(template, shellPaths) {
  const hash = createHash("sha256").update(template);
  for (const shellPath of shellPaths) {
    hash.update("\0").update(shellPath).update("\0");
    hash.update(await readFile(outputFileForShellPath(shellPath)));
  }
  return hash.digest("hex").slice(0, 20);
}

export async function generateServiceWorker() {
  const [template, html] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(path.join(outputRoot, "index.html"), "utf8"),
  ]);
  const revision = await buildRevision(template, discoverShellPaths(html));
  const worker = renderServiceWorker({ template, html, revision });
  await writeFile(path.join(outputRoot, "sw.js"), worker);
  return revision;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const revision = await generateServiceWorker();
  process.stdout.write(`Generated offline shell revision ${revision}.\n`);
}
