import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const INITIAL_JS_RAW_BUDGET = 1_350_000;
export const INITIAL_JS_GZIP_BUDGET = 350_000;

export function measureInitialJavaScript(outputDirectory = "out") {
  const root = resolve(outputDirectory);
  const indexPath = resolve(root, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`Static output is missing at ${indexPath}. Run npm run build first.`);
  }
  const html = readFileSync(indexPath, "utf8");
  const sources = [...new Set(
    [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]),
  )];
  if (sources.length === 0) throw new Error("Static index contains no JavaScript chunks.");

  let rawBytes = 0;
  let gzipBytes = 0;
  for (const source of sources) {
    const file = resolve(root, source.replace(/^\//, ""));
    const bytes = readFileSync(file);
    rawBytes += bytes.byteLength;
    gzipBytes += gzipSync(bytes, { level: 9 }).byteLength;
  }
  return { chunkCount: sources.length, rawBytes, gzipBytes, sources };
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

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const measurement = measureInitialJavaScript(process.argv[2] ?? "out");
  assertInitialJavaScriptBudget(measurement);
  console.log(
    `Initial JavaScript: ${measurement.rawBytes} raw bytes, ${measurement.gzipBytes} gzip bytes across ${measurement.chunkCount} chunks.`,
  );
}
