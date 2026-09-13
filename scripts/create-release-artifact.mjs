import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { assertCleanRelease } from "./assert-clean-release.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function relativeFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Release output must not contain symbolic links: ${absolute}`);
    }
    if (entry.isDirectory()) return relativeFiles(root, absolute);
    if (!entry.isFile()) throw new Error(`Unsupported release output entry: ${absolute}`);
    return [path.relative(root, absolute).split(path.sep).join("/")];
  }).sort();
}

function writeString(buffer, offset, length, value) {
  const encoded = Buffer.from(value);
  if (encoded.length > length) throw new Error(`Tar field is too long: ${value}`);
  encoded.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  const encoded = `${value.toString(8).padStart(length - 1, "0")}\0`;
  writeString(buffer, offset, length, encoded);
}

function tarPathParts(archivePath) {
  if (Buffer.byteLength(archivePath) <= 100) return { name: archivePath, prefix: "" };
  const segments = archivePath.split("/");
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const prefix = segments.slice(0, index).join("/");
    const name = segments.slice(index).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`Release path exceeds the portable ustar limit: ${archivePath}`);
}

function tarHeader(archivePath, size) {
  const header = Buffer.alloc(512);
  const { name, prefix } = tarPathParts(archivePath);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, "0");
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function deterministicTar(outDir, files, rootName) {
  const blocks = [];
  for (const relativePath of files) {
    const content = readFileSync(path.join(outDir, ...relativePath.split("/")));
    blocks.push(tarHeader(`${rootName}/${relativePath}`, content.length), content);
    const remainder = content.length % 512;
    if (remainder) blocks.push(Buffer.alloc(512 - remainder));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function sanitizedSbom(sbom) {
  const copy = structuredClone(sbom);
  delete copy.serialNumber;
  if (copy.metadata && typeof copy.metadata === "object") delete copy.metadata.timestamp;
  return copy;
}

export async function createReleaseBundle({
  outDir,
  artifactsDir,
  version,
  commit,
  sbom,
}) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("A full lowercase release commit is required.");
  if (!statSync(outDir).isDirectory()) throw new Error(`Static output directory is missing: ${outDir}`);
  mkdirSync(artifactsDir, { recursive: true });

  const files = relativeFiles(outDir);
  if (!files.includes("index.html")) throw new Error("Static release output is missing index.html.");
  const archiveName = `stellarkey-${version}.tar.gz`;
  const sbomName = `stellarkey-${version}.cdx.json`;
  const archivePath = path.join(artifactsDir, archiveName);
  const inventoryPath = path.join(artifactsDir, "release-files.json");
  const sbomPath = path.join(artifactsDir, sbomName);
  const checksumsPath = path.join(artifactsDir, "SHA256SUMS");
  const archive = gzipSync(deterministicTar(outDir, files, `stellarkey-${version}`), {
    level: 9,
    mtime: 0,
  });
  writeFileSync(archivePath, archive);
  writeFileSync(sbomPath, stableJson(sanitizedSbom(sbom)));

  const inventory = {
    schemaVersion: 1,
    product: "StellarKey",
    version,
    commit,
    digestAlgorithm: "SHA-256",
    archive: {
      file: archiveName,
      size: archive.length,
      sha256: sha256(archive),
    },
    files: files.map((relativePath) => {
      const content = readFileSync(path.join(outDir, ...relativePath.split("/")));
      return { path: relativePath, size: content.length, sha256: sha256(content) };
    }),
  };
  writeFileSync(inventoryPath, stableJson(inventory));

  const checksumFiles = [archivePath, inventoryPath, sbomPath].sort((left, right) =>
    path.basename(left).localeCompare(path.basename(right)));
  writeFileSync(
    checksumsPath,
    `${checksumFiles.map((file) => `${sha256(readFileSync(file))}  ${path.basename(file)}`).join("\n")}\n`,
  );
  return { archivePath, inventoryPath, sbomPath, checksumsPath };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function npmSbom(cwd) {
  const raw = execFileSync(
    "npm",
    ["sbom", "--omit=dev", "--package-lock-only", "--sbom-format", "cyclonedx", "--sbom-type", "application"],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(raw);
}

function validateBuiltManifest(outDir, { commit, version }) {
  const manifest = JSON.parse(readFileSync(path.join(outDir, "release.json"), "utf8"));
  if (
    manifest.commit !== commit ||
    manifest.version !== version ||
    manifest.sourceTree !== "clean" ||
    manifest.verifiable !== true
  ) {
    throw new Error("out/release.json does not describe this clean release commit and version.");
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const state = assertCleanRelease({
    expectedCommit: argumentValue("--commit") ?? process.env.GITHUB_SHA,
    tag: argumentValue("--tag") ?? process.env.GITHUB_REF_NAME,
  });
  const outDir = path.join(defaultRoot, "out");
  validateBuiltManifest(outDir, state);
  const result = await createReleaseBundle({
    outDir,
    artifactsDir: path.join(defaultRoot, "release-artifacts"),
    version: state.version,
    commit: state.commit,
    sbom: npmSbom(defaultRoot),
  });
  process.stdout.write(`Created ${path.basename(result.archivePath)} and verifiable release metadata.\n`);
}
