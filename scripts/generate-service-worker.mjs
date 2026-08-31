import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputRoot = path.join(projectRoot, "out");
const templatePath = path.join(projectRoot, "public", "sw.js");
const privateManifestPath = path.join(
  outputRoot,
  "protocol",
  "private-balance",
  "v1",
  "manifest.json",
);
const BUILD_ORIGIN = "https://stellarkey.invalid";

export const PUBLIC_DOCUMENT_PATHS = Object.freeze([
  "/",
  "/app",
  "/about",
  "/privacy",
  "/terms",
  "/security",
  "/private",
  "/support",
  "/changelog",
]);

export const BASE_SHELL_PATHS = Object.freeze([
  ...PUBLIC_DOCUMENT_PATHS,
  "/favicon.ico",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
  "/icon-maskable-1024.png",
  "/apple-icon.png",
  "/apple-icon1.png",
  "/apple-icon2.png",
  "/apple-touch-icon.png",
]);

function isShellPath(url) {
  return url.origin === BUILD_ORIGIN && (
    BASE_SHELL_PATHS.includes(url.pathname) || url.pathname.startsWith("/_next/static/")
  );
}

/** Exact HTML resources plus install metadata; external services are excluded. */
export function discoverShellPaths(htmlDocuments) {
  const paths = new Set(BASE_SHELL_PATHS);
  const documents = Array.isArray(htmlDocuments) ? htmlDocuments : [htmlDocuments];
  for (const html of documents) {
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const url = new URL(match[1], BUILD_ORIGIN);
      if (isShellPath(url)) paths.add(`${url.pathname}${url.search}`);
    }
  }
  return [...paths];
}

export function renderServiceWorker({
  template,
  html,
  htmlDocuments = html,
  revision,
  privateArtifacts = [],
  privateArtifactRevision = revision,
}) {
  if (!/^[a-zA-Z0-9._-]+$/.test(revision)) {
    throw new Error("Service-worker revision contains unsupported characters.");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(privateArtifactRevision)) {
    throw new Error("Private-artifact revision contains unsupported characters.");
  }
  const paths = discoverShellPaths(htmlDocuments);
  const revisionLine = /^const BUILD_REVISION = .*; \/\/ @generated-revision$/m;
  const precacheLine = /^const PRECACHE_PATHS = .*; \/\/ @generated-precache$/m;
  const privateRevisionLine = /^const PRIVATE_ARTIFACT_REVISION = .*; \/\/ @generated-private-artifact-revision$/m;
  const privateArtifactsLine = /^const PRIVATE_ARTIFACT_HASHES = .*; \/\/ @generated-private-artifacts$/m;
  if (
    !revisionLine.test(template) ||
    !precacheLine.test(template) ||
    !privateRevisionLine.test(template) ||
    !privateArtifactsLine.test(template)
  ) {
    throw new Error("Service-worker template is missing its generation markers.");
  }
  return template
    .replace(revisionLine, `const BUILD_REVISION = ${JSON.stringify(revision)}; // @generated-revision`)
    .replace(
      precacheLine,
      `const PRECACHE_PATHS = new Set(${JSON.stringify(paths)}); // @generated-precache`,
    )
    .replace(
      privateRevisionLine,
      `const PRIVATE_ARTIFACT_REVISION = ${JSON.stringify(privateArtifactRevision)}; // @generated-private-artifact-revision`,
    )
    .replace(
      privateArtifactsLine,
      `const PRIVATE_ARTIFACT_HASHES = new Map(${JSON.stringify(privateArtifacts)}); // @generated-private-artifacts`,
    );
}

export function privateArtifactsFromManifest(manifest) {
  const artifacts = manifest?.artifacts;
  const entries = [
    ["/protocol/private-balance/v1/circuit.wasm", artifacts?.wasmSha256],
    ["/protocol/private-balance/v1/circuit.zkey.pc", artifacts?.zkeyTransport?.sha256],
    ["/protocol/private-balance/v1/circuit.zkey", artifacts?.zkeySha256],
    ["/protocol/private-balance/v1/verification-key.json", artifacts?.vkJsonSha256],
  ];
  for (const [, hash] of entries) {
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error("Private Balance manifest contains an invalid artifact hash.");
    }
  }
  return entries;
}

function privateArtifactRevision(manifest, entries) {
  return createHash("sha256")
    .update(String(manifest.artifactVersion ?? ""))
    .update("\0")
    .update(JSON.stringify(entries))
    .digest("hex")
    .slice(0, 20);
}

export async function resolveOutputFile(shellPath, root = outputRoot) {
  const url = new URL(shellPath, BUILD_ORIGIN);
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const candidates = [relative];
  if (!path.extname(relative)) candidates.push(`${relative}.html`, path.join(relative, "index.html"));
  for (const candidate of candidates) {
    const resolved = path.resolve(root, candidate);
    if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
    try {
      if ((await stat(resolved)).isFile()) return resolved;
    } catch {
      // Try the next static-export representation.
    }
  }
  throw new Error(`Static shell resource is missing for ${url.pathname}.`);
}

async function buildRevision(template, shellPaths) {
  const hash = createHash("sha256").update(template);
  for (const shellPath of shellPaths) {
    hash.update("\0").update(shellPath).update("\0");
    hash.update(await readFile(await resolveOutputFile(shellPath)));
  }
  return hash.digest("hex").slice(0, 20);
}

export async function generateServiceWorker() {
  const [template, htmlDocuments, privateManifestSource] = await Promise.all([
    readFile(templatePath, "utf8"),
    Promise.all(
      PUBLIC_DOCUMENT_PATHS.map(async (route) => readFile(await resolveOutputFile(route), "utf8")),
    ),
    readFile(privateManifestPath, "utf8"),
  ]);
  const privateManifest = JSON.parse(privateManifestSource);
  const privateArtifacts = privateArtifactsFromManifest(privateManifest);
  const revision = await buildRevision(template, discoverShellPaths(htmlDocuments));
  const worker = renderServiceWorker({
    template,
    htmlDocuments,
    revision,
    privateArtifacts,
    privateArtifactRevision: privateArtifactRevision(privateManifest, privateArtifacts),
  });
  await writeFile(path.join(outputRoot, "sw.js"), worker);
  return revision;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const revision = await generateServiceWorker();
  process.stdout.write(`Generated offline shell revision ${revision}.\n`);
}
