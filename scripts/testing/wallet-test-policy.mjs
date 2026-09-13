import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const safeReporter = fileURLToPath(new URL('./safe-wallet-reporter.mjs', import.meta.url));

export function assertLiveWalletTestingSafe() {
  // Playwright 1.63: coreBundle.js Frame.expect captures matcher ARIA trees;
  // lib/index.js ArtifactsRecorder writes them via buildErrorContext even when
  // PLAYWRIGHT_NO_COPY_PROMPT=1 and screenshot/trace/video are off. There is no
  // supported suppression option. Deleting output afterwards is not prevention.
  throw new Error('Live wallet tests are blocked: this Playwright runner cannot disable locator failure snapshots. Use isolated non-usable synthetic fixtures.');
}

export function assertSafeWalletConfig(config, environment = process.env) {
  for (const project of config.projects) {
    for (const capture of ['screenshot', 'trace', 'video']) {
      if (project.use[capture] !== 'off') throw new Error('Wallet test capture must remain off.');
    }
  }
  if (config.preserveOutput !== 'never') throw new Error('Wallet test output must not be retained.');
  if (environment.PW_TEST_REPORTER || config.reporter.length !== 1 || path.resolve(config.reporter[0][0]) !== safeReporter) {
    throw new Error('Wallet tests require the structural-only safe reporter.');
  }
}

export function assertNoPrivateComponentFixture(cwd = projectRoot) {
  const marker = 'private-component-fixture';
  if (existsSync(path.join(cwd, 'src/app', marker))) {
    throw new Error('Synthetic private-component fixture remains in source.');
  }
  const visit = directory => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.name.includes(marker) || entry.isSymbolicLink()) {
        throw new Error('Synthetic fixture or unexpected symlink remains in the static export.');
      }
      if (entry.isDirectory()) visit(file);
      else if (readFileSync(file).includes(marker)) {
        throw new Error('Synthetic fixture reference remains in the static export.');
      }
    }
  };
  visit(path.join(cwd, 'out'));
}

export default function setup(config) {
  assertSafeWalletConfig(config);
  if (process.env.PRIVATE_BALANCE_E2E_SENDER_SECRET || process.env.PRIVATE_BALANCE_E2E_RECIPIENT_SECRET) {
    assertLiveWalletTestingSafe();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assertNoPrivateComponentFixture();
  process.stdout.write('Synthetic fixture source and export cleanup verified.\n');
}
