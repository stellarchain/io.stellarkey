import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');

test('shared Button preserves its accessible purpose and width while pending', () => {
  const button = ui.match(/export function Button\([\s\S]*?\n}\n\nexport function Field/)?.[0] ?? '';

  assert.doesNotMatch(button, /loading\s*\?\s*<Spinner\s*\/>\s*:\s*children/);
  assert.match(button, /aria-busy=\{loading \|\| undefined\}/);
  assert.match(button, /disabled=\{disabled \|\| loading\}/);
  assert.match(button, /data-loading=\{loading \|\| undefined\}/);
  assert.match(button, /loading \? "opacity-0"/);
  assert.match(button, /whitespace-normal/);
  assert.match(button, /\{children\}/);
  assert.match(button, /role="status"/);
  assert.match(button, /aria-live="polite"/);
  assert.match(button, /aria-label=\{loadingLabel\}/);
  assert.match(button, /loadingLabel/);
});

test('shared Field associates its label, hint, existing description, and error', () => {
  const field = ui.match(/export function Field\([\s\S]*?\n}\n\nexport function ErrorText/)?.[0] ?? '';

  assert.match(field, /htmlFor=\{controlId\}/);
  assert.match(field, /hintId/);
  assert.match(field, /errorId/);
  assert.match(field, /children\.props\["aria-describedby"\]/);
  assert.match(field, /filter\(Boolean\)\.join\(" "\)/);
  assert.match(field, /aria-invalid/);
  assert.match(field, /role="alert"/);
});

test('critical wallet modal shells do not wait for an outer dynamic chunk', () => {
  for (const [component, source] of [
    ['SendModal', 'SendModal'],
    ['ReceiveModal', 'ReceiveModal'],
    ['AddAssetModal', 'AddAssetModalShell'],
  ]) {
    assert.match(dashboard, new RegExp(`import \\{[^}]*${component}[^}]*\\} from "\\./${source}";`));
    assert.doesNotMatch(dashboard, new RegExp(`const ${component} = dynamic\\(`));
  }
});
