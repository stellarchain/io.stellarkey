import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  MODAL_EXIT_DURATION_MS,
  MODAL_SHEET_EXIT_DURATION_MS,
  POPOVER_EXIT_DURATION_MS,
  REDUCED_MOTION_EXIT_DURATION_MS,
  TOAST_EXIT_DURATION_MS,
} from '../src/lib/motion.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('src/app/globals.css');
const ui = read('src/components/ui.tsx');

function sourceFiles(dir = 'src') {
  const out = [];
  const walk = (relative) => {
    for (const entry of readdirSync(new URL(`../${relative}/`, import.meta.url), { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx$/.test(entry.name)) out.push(next);
    }
  };
  walk(dir);
  return out;
}

const modalFiles = sourceFiles().filter((path) => /<Modal\b/.test(read(path)) && !path.endsWith('ui.tsx'));

test('motion tokens align the modal lifecycle with its CSS exit animation', () => {
  assert.equal(MODAL_EXIT_DURATION_MS, 180);
  assert.equal(MODAL_SHEET_EXIT_DURATION_MS, 260);
  assert.equal(REDUCED_MOTION_EXIT_DURATION_MS, 120);
  assert.equal(POPOVER_EXIT_DURATION_MS, 120);
  assert.equal(TOAST_EXIT_DURATION_MS, 180);
  assert.match(css, /--motion-duration-fast:\s*120ms/);
  assert.match(css, /--motion-duration-standard:\s*180ms/);
  assert.match(css, /--motion-duration-emphasized:\s*220ms/);
  assert.match(css, /--motion-duration-sheet-in:\s*380ms/);
  assert.match(css, /--motion-duration-sheet-out:\s*260ms/);
  assert.match(css, /--motion-ease-standard:/);
  assert.match(css, /--motion-ease-enter:/);
  assert.match(css, /\.modal-overlay\.closing\s*\{[^}]*var\(--motion-duration-standard\)/s);
  // Panel and dim leave together.
  assert.match(css, /\.modal-dialog\.closing\s*\{[^}]*var\(--motion-duration-standard\)/s);
  assert.match(css, /\.modal-sheet\.closing\s*\{[^}]*var\(--motion-duration-sheet-out\)/s);
  assert.match(css, /\.modal-overlay\[data-presentation="sheet"\]\.closing\s*\{[^}]*var\(--motion-duration-sheet-out\)/s);
  assert.match(css, /\.menu-pop\.closing\s*\{[^}]*var\(--motion-duration-fast\)/s);
  assert.match(css, /\.toast-leave\s*\{[^}]*var\(--motion-duration-standard\)/s);
  assert.match(ui, /MODAL_EXIT_DURATION_MS/);
  assert.match(ui, /MODAL_SHEET_EXIT_DURATION_MS/);
  assert.match(ui, /REDUCED_MOTION_EXIT_DURATION_MS/);
  assert.doesNotMatch(ui, /window\.setTimeout\([^,]+,\s*180\)/);
});

test('shared components avoid broad transitions and retain reduced-motion support', () => {
  assert.doesNotMatch(ui, /transition-all/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /transition-duration:\s*0\.01ms !important/);
  // Reduce Motion replaces spatial motion with a crossfade rather than removing feedback.
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.modal-sheet,\s*\.modal-alert,[\s\S]*?animation: fadeIn var\(--motion-duration-fast\) linear both !important/);
  assert.match(reduced, /\.modal-sheet\.closing,[\s\S]*?animation: fadeOut var\(--motion-duration-fast\) linear both !important/);
});

test('the shell presents sheets on compact widths and alerts for confirmations', () => {
  assert.match(ui, /presentation === "auto" \? \(compact \? "sheet" : "card"\) : presentation/);
  assert.match(ui, /data-presentation=\{resolvedPresentation\}/);
  assert.match(ui, /className="modal-grabber"/);
  assert.match(ui, /export function ConfirmModal/);
  assert.match(ui, /presentation="alert"/);
  assert.match(css, /@keyframes sheetIn[\s\S]*?translate3d\(0, 100%, 0\)/);
  assert.match(css, /@keyframes alertIn[\s\S]*?scale\(1\.1\)/);
});

test('the shell holds its exit geometry so owners can clear content on close', () => {
  assert.match(ui, /const \[panelSize, setPanelSize\] = useState/);
  assert.match(ui, /const width = panel\.offsetWidth;\s*const height = panel\.offsetHeight;/);
  assert.match(ui, /new ResizeObserver\(record\)/);
  assert.match(ui, /height: exitGeometry\.height/);
  assert.match(ui, /presentation: livePresentation,\s*wide,/);
});

test('the shell routes every dismissal through one busy and dirty policy', () => {
  assert.match(ui, /const requestClose = useCallback\(\(reason: ModalCloseReason, action\?: \(\) => void\): boolean =>/);
  assert.match(ui, /if \(busyRef\.current\) return false;/);
  assert.match(ui, /if \(isDirty && reason !== "programmatic" && reason !== "back"\)/);
  // Backdrop dismissal needs press and release on the dim without travel.
  assert.match(ui, /onPointerUp=\{\(e\) => \{[\s\S]*?BACKDROP_TAP_SLOP_PX/);
  assert.doesNotMatch(ui, /onMouseDown=\{\(e\) => \{\s*if \(e\.target === backdropRef\.current/);
  // Opening, dismissing and navigating play no haptic.
  const modalBlock = ui.slice(ui.indexOf('export function Modal('), ui.indexOf('const MODAL_BODY_GAP'));
  assert.doesNotMatch(modalBlock, /triggerHaptic\(/);
  const backButton = ui.slice(ui.indexOf('export function IOSBackButton'), ui.indexOf('export type ModalPresentation'));
  assert.doesNotMatch(backButton, /triggerHaptic\(/);
});

test('modal owners keep the shell mounted through its exit lifecycle', () => {
  const failures = [];
  for (const path of modalFiles) {
    const source = read(path);
    for (const match of source.matchAll(/<Modal\b[^>]*?\sopen(?=[\s>])(?!=)/g)) {
      failures.push(`${path}: <Modal open> with a literal open at offset ${match.index}; pass the owner's open state`);
    }
    const before = source.slice(0, source.indexOf('<Modal'));
    for (const match of before.matchAll(/if \(!(open|item|asset|order|charge|invoice|customer|code|entry|request|value|account|raw|publicBalance|activeAccount)\) return null;/g)) {
      failures.push(`${path}: "${match[0]}" unmounts the dialog before its exit animation`);
    }
  }
  assert.deepEqual(failures, []);
});

test('modal files use motion tokens rather than transition-all or duration literals', () => {
  const failures = [];
  for (const path of modalFiles) {
    const source = read(path);
    if (/transition-all/.test(source)) failures.push(`${path}: transition-all`);
    for (const match of source.matchAll(/duration-\[?\d+m?s?\]?/g)) failures.push(`${path}: ${match[0]}`);
  }
  assert.deepEqual(failures, []);
});
