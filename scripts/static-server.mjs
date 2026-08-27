import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputRoot = path.join(projectRoot, "out");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hostname = option("--hostname", "127.0.0.1");
const port = Number(option("--port", process.env.PORT ?? "3000"));

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function parseHeaderRules(raw) {
  const rules = [];
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    current.headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return rules;
}

const headerRules = parseHeaderRules(await readFile(path.join(outputRoot, "_headers"), "utf8"));
function headersFor(urlPath) {
  const headers = {};
  for (const rule of headerRules) {
    if (rule.pattern === "/*" || rule.pattern === urlPath) Object.assign(headers, rule.headers);
  }
  return headers;
}

async function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidates = [relative];
  if (!path.extname(relative)) candidates.push(`${relative}.html`, path.join(relative, "index.html"));
  for (const candidate of candidates) {
    const fullPath = path.resolve(outputRoot, candidate);
    if (!fullPath.startsWith(`${outputRoot}${path.sep}`)) continue;
    try {
      if ((await stat(fullPath)).isFile()) return fullPath;
    } catch {
      // Try the next static route representation.
    }
  }
  return null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const filePath = await resolveFile(url.pathname);
  if (!filePath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const headers = headersFor(url.pathname);
  headers["Content-Type"] = mimeTypes.get(path.extname(filePath)) ?? "application/octet-stream";
  response.writeHead(200, headers);
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
});

server.listen(port, hostname, () => {
  process.stdout.write(`Static wallet available at http://${hostname}:${port}\n`);
});
