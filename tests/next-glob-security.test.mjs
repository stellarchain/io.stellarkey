import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const configRequire = createRequire(require.resolve('eslint-config-next'));
const pluginPath = configRequire.resolve('@next/eslint-plugin-next');
const pluginRequire = createRequire(pluginPath);
const globRequire = createRequire(pluginRequire.resolve('fast-glob'));
const matcherRequire = createRequire(globRequire.resolve('micromatch'));
const braces = matcherRequire('braces');
const { getRootDirs } = pluginRequire('./utils/get-root-dirs.js');
const nested = (depth) => '{'.repeat(depth) + 'web,admin' + '}'.repeat(depth);
const isDepthError = (error) => /exceeds max depth \(100\)/.test(error.message);

test('Next root discovery rejects excessive brace depth through its installed glob adapter', () => {
  assert.throws(
    () => getRootDirs({ cwd: tmpdir(), settings: { next: { rootDir: nested(101) } } }),
    (error) => error instanceof SyntaxError && isDepthError(error),
  );
});

test('installed brace parsing and traversal enforce the depth bound even with oversized limits', () => {
  for (const method of ['parse', 'compile', 'stringify', 'expand']) {
    assert.doesNotThrow(() => braces[method](nested(100)));
    for (const maxDepth of [undefined, 1000, Infinity, NaN]) {
      assert.throws(() => braces[method](nested(101), { maxDepth }), isDepthError);
    }
  }
  for (const method of ['compile', 'stringify', 'expand']) {
    const ast = { type: 'root', nodes: [] };
    let parent = ast;
    for (let depth = 0; depth < 101; depth++) {
      const child = { type: 'paren', nodes: [], parent };
      parent.nodes.push(child);
      parent = child;
    }
    assert.throws(() => braces[method](ast), (error) => error instanceof RangeError && isDepthError(error));
  }
});

test('installed brace parsing cannot bypass its input bound with NaN or a changing option', () => {
  assert.throws(() => braces.parse('x'.repeat(10001), { maxLength: NaN }), RangeError);
  let reads = 0;
  assert.throws(() => braces.parse('x'.repeat(10001), {
    get maxLength() { return ++reads === 1 ? 10000 : NaN; },
  }), /exceeds max characters/);
  assert.equal(reads, 1);
});

test('Next root discovery and page-link linting preserve ordinary brace and range globs', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'stellarkey-next-glob-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const app of ['web', 'admin', 'worker1', 'worker2', 'other']) {
    mkdirSync(join(fixture, 'apps', app, 'pages'), { recursive: true });
  }
  writeFileSync(join(fixture, 'apps', 'web', 'pages', 'about.jsx'), 'export default function About() {}');
  const rootDir = join(fixture, 'apps', '{web,admin,worker{1..2}}');
  assert.deepEqual(
    getRootDirs({ cwd: fixture, settings: { next: { rootDir } } }).sort(),
    ['admin', 'web', 'worker1', 'worker2'].map((app) => join(fixture, 'apps', app)).sort(),
  );
  const eslint = new ESLint({
    cwd: fixture,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.jsx'],
      plugins: { '@next/next': require(pluginPath) },
      rules: { '@next/next/no-html-link-for-pages': 'error' },
      settings: { next: { rootDir } },
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    }],
  });
  const [result] = await eslint.lintText('export default function Page() { return <a href="/about">About</a>; }', {
    filePath: join(fixture, 'page.jsx'),
  });
  assert.equal(result.fatalErrorCount, 0);
  assert.equal(result.errorCount, 1);
  assert.equal(result.messages[0].ruleId, '@next/next/no-html-link-for-pages');
});
