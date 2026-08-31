import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODAL_EXIT_DURATION_MS } from '../src/lib/motion.ts';

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');

test('motion tokens align the modal lifecycle with its CSS exit animation', () => {
  assert.equal(MODAL_EXIT_DURATION_MS, 180);
  assert.match(css, /--motion-duration-fast:\s*120ms/);
  assert.match(css, /--motion-duration-standard:\s*180ms/);
  assert.match(css, /--motion-duration-emphasized:\s*220ms/);
  assert.match(css, /--motion-ease-standard:/);
  assert.match(css, /--motion-ease-enter:/);
  assert.match(css, /\.modal-overlay\.closing\s*\{[^}]*var\(--motion-duration-standard\)/s);
  assert.match(ui, /MODAL_EXIT_DURATION_MS/);
  assert.doesNotMatch(ui, /window\.setTimeout\([^,]+,\s*180\)/);
});

test('shared components avoid broad transitions and retain reduced-motion support', () => {
  assert.doesNotMatch(ui, /transition-all/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /transition-duration:\s*0\.01ms !important/);
});
