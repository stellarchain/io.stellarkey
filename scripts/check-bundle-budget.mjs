import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const INITIAL_JS_RAW_BUDGET = 1_350_000;
export const INITIAL_JS_GZIP_BUDGET = 350_000;

/** Incremental bytes needed to enter each named journey. */
export const JOURNEY_BUDGETS = Object.freeze({
  initial: { rawBytes: INITIAL_JS_RAW_BUDGET, gzipBytes: INITIAL_JS_GZIP_BUDGET },
  unlocked: { rawBytes: 725_000, gzipBytes: 160_000 },
  merchant: { rawBytes: 390_000, gzipBytes: 105_000 },
  hardware: { rawBytes: 1_100_000, gzipBytes: 225_000 },
});

function outputSource(source) {
  const pathname = new URL(source, "https://polaris.invalid").pathname;
  if (pathname.startsWith("/_next/")) return pathname.slice(1);
  if (pathname.startsWith("/static/")) return `_next${pathname}`;
  if (source.startsWith("static/")) return `_next/${source}`;
  throw new Error(`Unsupported JavaScript resource in build graph: ${source}`);
}

function initialSources(root) {
  const indexPath = resolve(root, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`Static output is missing at ${indexPath}. Run npm run build first.`);
  }
  const html = readFileSync(indexPath, "utf8");
  const sources = [...new Set(
    [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => outputSource(match[1])),
  )];
  if (sources.length === 0) throw new Error("Static index contains no JavaScript chunks.");
  return sources;
}

function measureSources(root, sources) {
  let rawBytes = 0;
  let gzipBytes = 0;
  const ordered = [...new Set(sources)].sort();
  for (const source of ordered) {
    const bytes = readFileSync(resolve(root, source));
    rawBytes += bytes.byteLength;
    gzipBytes += gzipSync(bytes, { level: 9 }).byteLength;
  }
  return { chunkCount: ordered.length, rawBytes, gzipBytes, sources: ordered };
}

export function measureInitialJavaScript(outputDirectory = "out") {
  const root = resolve(outputDirectory);
  return measureSources(root, initialSources(root));
}

export function assertInitialJavaScriptBudget(measurement) {
  const failures = [];
  if (measurement.rawBytes > INITIAL_JS_RAW_BUDGET) {
    failures.push(`${measurement.rawBytes} raw bytes exceeds ${INITIAL_JS_RAW_BUDGET}`);
  }
  if (measurement.gzipBytes > INITIAL_JS_GZIP_BUDGET) {
    failures.push(`${measurement.gzipBytes} gzip bytes exceeds ${INITIAL_JS_GZIP_BUDGET}`);
  }
  if (failures.length > 0) {
    throw new Error(`Initial JavaScript budget failed: ${failures.join("; ")}.`);
  }
}

function chunkContents(root) {
  const directory = resolve(root, "_next/static/chunks");
  return new Map(
    readdirSync(directory)
      .filter((name) => name.endsWith(".js"))
      .map((name) => {
        const source = `_next/static/chunks/${name}`;
        return [source, readFileSync(resolve(root, source), "utf8")];
      }),
  );
}

/** Turbopack's emitted async-module table maps stable-in-build IDs to chunk sets. */
function asyncChunkMap(contents) {
  const mappings = new Map();
  const loader = /(?:^|[;,}])(\d+),[$\w]+=>\{[$\w]+\.v\([$\w]+=>Promise\.all\((\[[^\]]*\])\.map/g;
  for (const content of contents.values()) {
    for (const match of content.matchAll(loader)) {
      const chunks = JSON.parse(match[2]).map(outputSource);
      mappings.set(Number(match[1]), chunks);
    }
  }
  return mappings;
}

function namedBoundaryIds(contents, exportNames) {
  const names = exportNames.join("|");
  const boundary = new RegExp(`\\.A\\((\\d+)\\)\\.then\\([^)]{0,120}\\.(?:${names})\\)`, "g");
  const ids = new Set();
  for (const content of contents.values()) {
    for (const match of content.matchAll(boundary)) ids.add(Number(match[1]));
  }
  return ids;
}

function markerIds(contents, markers) {
  const ids = new Set();
  for (const content of contents.values()) {
    for (const match of content.matchAll(/\.A\((\d+)\)/g)) {
      const around = content.slice(Math.max(0, match.index - 180), match.index + match[0].length + 180);
      if (markers.some((marker) => around.includes(marker))) ids.add(Number(match[1]));
    }
  }
  return ids;
}

function chunksForIds(ids, mappings, label) {
  const chunks = new Set();
  for (const id of ids) {
    const mapped = mappings.get(id);
    if (!mapped) throw new Error(`Build graph has no chunk mapping for ${label} async module ${id}.`);
    for (const chunk of mapped) chunks.add(chunk);
  }
  if (chunks.size === 0) throw new Error(`Build graph did not resolve the ${label} journey.`);
  return chunks;
}

function transitiveAsyncChunks(start, contents, mappings) {
  const chunks = new Set(start);
  const queue = [...chunks];
  while (queue.length > 0) {
    const source = queue.shift();
    const content = contents.get(source);
    if (!content) continue;
    for (const match of content.matchAll(/\.A\((\d+)\)/g)) {
      for (const chunk of mappings.get(Number(match[1])) ?? []) {
        if (chunks.has(chunk)) continue;
        chunks.add(chunk);
        queue.push(chunk);
      }
    }
  }
  return chunks;
}

function without(sources, excluded) {
  return [...sources].filter((source) => !excluded.has(source));
}

export function measureJourneyJavaScript(outputDirectory = "out", buildDirectory = ".next") {
  const root = resolve(outputDirectory);
  const initial = new Set(initialSources(root));
  const contents = chunkContents(root);
  const mappings = asyncChunkMap(contents);
  const loadableManifestPath = resolve(
    buildDirectory,
    "server/app/page/react-loadable-manifest.json",
  );
  if (!existsSync(loadableManifestPath)) {
    throw new Error(`Next loadable manifest is missing at ${loadableManifestPath}. Run npm run build first.`);
  }
  const loadable = JSON.parse(readFileSync(loadableManifestPath, "utf8"));
  const unlocked = new Set(
    Object.values(loadable).flatMap((entry) => entry.files.map(outputSource)),
  );
  const unlockedIncrement = new Set(without(unlocked, initial));

  const merchant = chunksForIds(
    namedBoundaryIds(contents, ["MerchantPage", "SetupWizard"]),
    mappings,
    "merchant",
  );
  const merchantIncrement = without(merchant, new Set([...initial, ...unlockedIncrement]));

  const hardwareRoots = chunksForIds(
    markerIds(contents, ["connectTrezorDevice", "warmTrezorConnect"]),
    mappings,
    "hardware",
  );
  const hardware = transitiveAsyncChunks(hardwareRoots, contents, mappings);
  const hardwareIncrement = without(hardware, initial);

  return {
    initial: measureSources(root, initial),
    unlocked: measureSources(root, unlockedIncrement),
    merchant: measureSources(root, merchantIncrement),
    hardware: measureSources(root, hardwareIncrement),
  };
}

export function assertJourneyJavaScriptBudgets(measurements, budgets = JOURNEY_BUDGETS) {
  const failures = [];
  for (const [journey, budget] of Object.entries(budgets)) {
    const measurement = measurements[journey];
    if (!measurement) {
      failures.push(`${journey}: measurement is missing`);
      continue;
    }
    if (measurement.rawBytes > budget.rawBytes) {
      failures.push(`${journey}: ${measurement.rawBytes} raw bytes exceeds ${budget.rawBytes}`);
    }
    if (measurement.gzipBytes > budget.gzipBytes) {
      failures.push(`${journey}: ${measurement.gzipBytes} gzip bytes exceeds ${budget.gzipBytes}`);
    }
  }
  if (failures.length > 0) {
    const first = failures[0];
    const label = first.slice(0, first.indexOf(":"));
    throw new Error(`${label[0].toUpperCase()}${label.slice(1)} JavaScript budget failed: ${failures.join("; ")}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const measurements = measureJourneyJavaScript(process.argv[2] ?? "out", process.argv[3] ?? ".next");
  assertJourneyJavaScriptBudgets(measurements);
  for (const [journey, measurement] of Object.entries(measurements)) {
    console.log(
      `${journey[0].toUpperCase()}${journey.slice(1)} JavaScript: ${measurement.rawBytes} raw bytes, ${measurement.gzipBytes} gzip bytes across ${measurement.chunkCount} chunks.`,
    );
  }
}
