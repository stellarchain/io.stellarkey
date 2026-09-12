import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const statuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const projects = new Set(['desktop-chromium', 'desktop-chromium-dark', 'desktop-firefox-private', 'desktop-webkit-private', 'iphone-webkit', 'ipad-webkit', 'synthetic-safety-probe']);

function safeSourceFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.normalize(file) !== file) return null;
  const relative = path.relative(projectRoot, file);
  return /^(?:e2e|tests\/fixtures)\/[a-zA-Z0-9_./-]+\.spec\.[cm]?[jt]s$/.test(relative)
    && !relative.includes('..') && !/\s/.test(relative) ? relative : null;
}

// Never forward titles, errors, call logs, stdout/stderr or attachments. They
// can contain keys, locator values, accessible names and complete ARIA trees.
// Source locations, fixed status labels and counts retain actionable diagnostics.
export default class SafeWalletReporter {
  constructor(options = {}) {
    this.write = options.write ?? (text => process.stdout.write(text));
    this.completed = 0;
    this.failures = 0;
    this.skipped = 0;
  }

  printsToStdio() { return true; }

  onBegin(config, suite) {
    this.requireExecutedTests = config.metadata?.requiredSyntheticComponents === true && !process.argv.includes('--list');
    this.write(`Wallet browser checks: ${suite.allTests().length} collected.\n`);
  }

  onStdOut() {}
  onStdErr() {}

  onError() {
    this.write('Runner error: browser verification could not complete.\n');
  }

  onStepEnd(test, _result, step) {
    if (!step.error) return;
    const location = step.location;
    if (!location || location.file !== test.location?.file || !Number.isSafeInteger(location.line) || location.line < 1) return;
    const file = safeSourceFile(location.file);
    if (file) this.write(`Wallet browser failed step: ${file}:${location.line}.\n`);
  }

  onTestEnd(test, result) {
    this.completed += 1;
    if (result.status === 'skipped') this.skipped += 1;
    const failed = result.status !== 'passed' && result.status !== 'skipped';
    if (failed) this.failures += 1;
    const file = safeSourceFile(test.location.file);
    const location = file
      ? `${file}:${Number.isSafeInteger(test.location.line) ? test.location.line : 0}`
      : 'browser check';
    const status = statuses.has(result.status) ? result.status : 'unknown';
    const project = test.parent?.project()?.name;
    const projectLabel = projects.has(project) ? project : 'browser';
    this.write(`[${projectLabel}] ${location}: ${status}; errors=${result.errors.length}; retry=${result.retry}.\n`);
  }

  onEnd(result) {
    const status = statuses.has(result.status) ? result.status : 'unknown';
    this.write(`Wallet browser result: ${status}; completed=${this.completed}; failed-attempts=${this.failures}; skipped=${this.skipped}.\n`);
    if (result.status === 'passed' && this.requireExecutedTests && (this.skipped > 0 || this.completed === 0)) {
      this.write('Required synthetic component checks did not all execute.\n');
      return { status: 'failed' };
    }
    // Otherwise preserve Playwright's failure/timeout/interruption.
  }
}
