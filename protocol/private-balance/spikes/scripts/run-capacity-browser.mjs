import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit, devices } from 'playwright';
import { fullCrossFixture } from '../../experiments/capacity-v2/fixtures.mjs';
import { createHash } from 'node:crypto';

const root = join(import.meta.dirname, '../..');
const files = new Map([
  ['/snarkjs.js', [join(root, '../../node_modules/snarkjs/build/snarkjs.min.js'), 'text/javascript']],
  ['/action.wasm', [join(root, 'circuits/build/action_js/action.wasm'), 'application/wasm']],
  ['/action.zkey', [join(root, 'circuits/build/action_dev.zkey'), 'application/octet-stream']],
  ['/vk.json', [join(root, 'circuits/build/verification_key.json'), 'application/json']],
]);
// An explicit allowlist serves only integrated development proving artifacts on loopback.
// There is no route for input data, repository files or wallet application state.
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Synthetic capacity benchmark</title><script src="/snarkjs.js"></script>'); return; }
  const item = files.get(req.url);
  if (!item) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', item[1]); res.end(readFileSync(item[0]));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const results = [];
try {
  for (const [name, engine, device, singleThread] of [
    ['chromium-default-workers', chromium, {}, false],
    ['webkit-iphone-emulation-default-workers', webkit, devices['iPhone 13'], false],
    ['chromium-single-thread', chromium, {}, true],
    ['webkit-iphone-emulation-single-thread', webkit, devices['iPhone 13'], true],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      // Fresh contexts; tracing, screenshots and video are never enabled.
      const context = await browser.newContext(device);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const input = fullCrossFixture().input;
      const metrics = await page.evaluate(async ({ input, singleThread }) => {
        const samples = [];
        const heapSamples = [];
        const vk = await (await fetch('/vk.json')).json();
        const startFetch = performance.now();
        const wasm = new Uint8Array(await (await fetch('/action.wasm')).arrayBuffer());
        const zkey = new Uint8Array(await (await fetch('/action.zkey')).arrayBuffer());
        const artifactFetchMs = performance.now() - startFetch;
        const sampleHeap = () => {
          const value = performance.memory?.usedJSHeapSize;
          if (Number.isFinite(value)) heapSamples.push(value);
        };
        const timer = setInterval(sampleHeap, 50);
        try {
          for (let i = 0; i < 3; i++) {
            sampleHeap();
            const started = performance.now();
            const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey, undefined, undefined, { singleThread });
            const proved = performance.now();
            if (!await snarkjs.groth16.verify(vk, publicSignals, proof)) throw new Error('synthetic proof verification failed');
            samples.push({ fullProveMs: proved - started, verifyMs: performance.now() - proved });
            sampleHeap();
          }
        } finally { clearInterval(timer); }
        return { samples, artifactFetchMs, observedJsHeapMaxBytes: heapSamples.length ? Math.max(...heapSamples) : null,
          memoryCaveat: 'Sampled JS heap only, not total or peak process/Wasm memory; main-thread work can delay sampling.',
          crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency, proverSingleThread: singleThread, verified: true };
      }, { input, singleThread });
      results.push({ name, engineVersion: browser.version(), physicalPhone: false, host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model }, ...metrics });
      console.log(`${name}: three full-depth cross-subtree proofs verified`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
writeFileSync(join(root, 'results/capacity-browser-v2.json'), JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), protocolVersion: 2, syntheticOnly: true, witnessSource: 'experiments/capacity-v2/fixtures.mjs:fullCrossFixture', artifacts: Object.fromEntries([...files.values()].map(([file]) => [file.slice(root.length + 1), createHash('sha256').update(readFileSync(file)).digest('hex')])), results }, null, 2) + '\n');
