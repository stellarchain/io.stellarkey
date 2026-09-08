import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual browser-measurement callbacks, not a second copy of the
// timing algorithm. Frame and task queues expose its rendering boundary.
const source = readFileSync(new URL('../e2e/relay-earn.spec.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('relay-earn.spec.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const measurements = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'evaluate') {
    const callback = node.arguments[0];
    const text = callback?.getText(parsed) ?? '';
    if (text.includes('const started = performance.now()') && text.includes('new MutationObserver')) {
      measurements.push({ label: text.includes('Stop relaying') ? 'feedback' : 'opening', text });
    }
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.equal(measurements.length, 2);

function measurement(callback) {
  let now = 0;
  let ready = false;
  let observer;
  let duration;
  let disconnected = false;
  const frames = [];
  const tasks = [];
  const button = { textContent: 'Start relaying', click() {} };
  const context = vm.createContext({
    performance: { now: () => now },
    document: {
      body: {},
      querySelector(selector) { return selector === '[data-modal-shell]' ? (ready ? {} : null) : button; },
    },
    MutationObserver: class {
      constructor(deliver) { observer = deliver; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    setTimeout(callback, delay) { assert.equal(delay, 0); tasks.push(callback); return tasks.length; },
  });
  const run = vm.runInContext(ts.transpileModule(`(${callback})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  run(button).then(value => { duration = value; });
  return {
    get duration() { return duration; },
    get frameCount() { return frames.length; },
    get disconnected() { return disconnected; },
    mutate(time, expected = false) {
      now = time;
      if (expected) { ready = true; button.textContent = 'Stop relaying'; }
      if (!disconnected) observer();
    },
    frame(time) {
      now = time;
      for (const callback of frames.splice(0)) callback(now);
    },
    postRenderTask(time) {
      now = time;
      for (const callback of tasks.splice(0)) callback();
    },
  };
}

for (const { label, text } of measurements) {
  test(`${label} lab proxy waits for acknowledgement and rendering, not an unrelated later frame`, async () => {
    const sample = measurement(text);
    sample.mutate(10);
    assert.equal(sample.frameCount, 0, 'unrelated mutations are not acknowledgement');
    assert.equal(sample.disconnected, false);
    sample.mutate(20, true);
    await Promise.resolve();
    assert.equal(sample.duration, undefined, 'DOM acknowledgement alone is not a rendering opportunity');
    assert.equal(sample.disconnected, true);
    sample.frame(30);
    await Promise.resolve();
    assert.equal(sample.duration, undefined, 'rAF runs before rendering');
    sample.postRenderTask(42);
    await Promise.resolve();
    assert.equal(sample.duration, 42, 'finish after rendering without waiting for another frame');
    assert.equal(sample.frameCount, 0);
    sample.frame(300);
    await Promise.resolve();
    assert.equal(sample.duration, 42, 'a later frame cannot change the completed sample');
  });

  test(`${label} lab proxy charges slow state acknowledgement to the original interaction`, async () => {
    const sample = measurement(text);
    sample.mutate(150, true);
    sample.frame(160);
    sample.postRenderTask(170);
    await Promise.resolve();
    assert.equal(sample.duration, 170);
    assert.ok(sample.duration > 100, 'slow acknowledgement must still fail the existing budget');
  });

  test(`${label} lab proxy charges rendering work after the frame callback`, async () => {
    const sample = measurement(text);
    sample.mutate(20, true);
    sample.frame(30);
    sample.postRenderTask(140);
    await Promise.resolve();
    assert.equal(sample.duration, 140);
    assert.ok(sample.duration > 100, 'slow rendering must still fail the existing budget');
  });
}

test('the relay lab retains every sample and its existing CPU and acknowledgement budgets', () => {
  assert.match(source, /Emulation\.setCPUThrottlingRate', \{ rate: 4 \}/);
  assert.match(source, /for \(let run = 0; run < 5; run\+\+\)/);
  assert.match(source, /expect\(Math\.max\(\.\.\.acknowledgement\)\)\.toBeLessThanOrEqual\(100\)/);
});
