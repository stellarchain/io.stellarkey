import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChangelog } from '../src/lib/changelog.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('the changelog parser rejects ambiguous or unsafe structure', () => {
  const invalid = [
    ['bullet before a category', '# Changelog\n## [Unreleased]\n- Orphaned entry'],
    [
      'duplicate release',
      '# Changelog\n## [Unreleased]\n### Changed\n- First\n## [Unreleased]\n### Changed\n- Second',
    ],
    ['malformed date', '# Changelog\n## [1.1.0] - 2026-02-30\n### Added\n- Entry'],
    ['raw HTML', '# Changelog\n<script>alert(1)</script>\n## [Unreleased]\n### Changed\n- Entry'],
    ['unsupported category', '# Changelog\n## [Unreleased]\n### Misc\n- Entry'],
    ['empty published release', '# Changelog\n## [1.1.0] - 2026-08-29'],
    ['empty unreleased category', '# Changelog\n## [Unreleased]\n### Changed'],
    ['dated unreleased section', '# Changelog\n## [Unreleased] - 2026-09-12\n### Changed\n- Entry'],
  ];

  for (const [label, source] of invalid) {
    assert.throws(() => parseChangelog(source), undefined, label);
  }
});

test('Unreleased accepts empty or categorized entries without changing the published release', () => {
  const published = '## [1.0.0] - 2026-09-13\n### Changed\n- Published entry\n';
  const expectedRelease = parseChangelog('# Changelog\n' + published).releases[0];
  for (const [pending, categories] of [
    ['', []],
    ['### Fixed\n- Fix artifact storage.\n', [{ name: 'Fixed', entries: ['Fix artifact storage.'] }]],
    ['### Changed\n- Update a dependency.\n', [{ name: 'Changed', entries: ['Update a dependency.'] }]],
  ]) {
    const document = parseChangelog('# Changelog\n## [Unreleased]\n' + pending + published);
    assert.deepEqual(document.releases[0], { version: 'Unreleased', date: null, categories });
    assert.deepEqual(document.releases[1], expectedRelease);
  }
});

test('the changelog starts at the approved 1.0.0 baseline', () => {
  const source = read('CHANGELOG.md');
  const document = parseChangelog(source);
  assert.deepEqual(document.releases.map(({ version }) => version), ['Unreleased', '1.0.1', '1.0.0']);
  assert.deepEqual(document.releases[0].categories, [{
    name: 'Fixed',
    entries: ['Start the Stellar trademark notice on a new line after the independence statement in public footers, About and Settings.'],
  }]);
  assert.equal(document.releases[1].date, '2026-09-13');
  assert.equal(document.releases[2].date, '2026-09-13');
  const notes = document.releases[2].categories.flatMap(({ entries }) => entries).join(' ');
  assert.match(notes, /stable starting application baseline/);
  assert.match(notes, /unaudited.*Testnet-only/);
  assert.match(notes, /GitHub Actions/);
  assert.match(notes, /history/);
  assert.match(source, /keepachangelog\.com/);
  assert.match(source, /semver\.org/);
});

test('all authoritative release markers agree on version 1.0.1', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const brand = read('src/lib/brand.ts');
  const security = read('SECURITY.md');
  const readme = read('README.md');

  assert.equal(packageJson.version, '1.0.1');
  assert.equal(packageLock.version, '1.0.1');
  assert.equal(packageLock.packages[''].version, '1.0.1');
  assert.match(brand, /APPLICATION_VERSION = "1\.0\.1"/);
  assert.match(security, /latest `1\.0\.x` release/i);
  assert.match(readme, /current release is `1\.0\.1`/i);
  assert.match(readme, /\[changelog\]\(CHANGELOG\.md\)/i);
});

test('agent and contributor policies keep version history synchronized', () => {
  const agents = read('AGENTS.md');
  const contributing = read('CONTRIBUTING.md');

  for (const policy of [agents, contributing]) {
    assert.match(policy, /\[Unreleased\]/);
    assert.match(policy, /Added\/Changed\/Deprecated\/Removed\/Fixed\/Security/);
    assert.match(policy, /Semantic Versioning|SemVer/i);
    assert.match(policy, /package\.json/);
    assert.match(policy, /package-lock\.json/);
    assert.match(policy, /APPLICATION_VERSION/);
    assert.match(policy, /SECURITY\.md/);
    assert.match(policy, /README\.md/);
    assert.match(policy, /npm run release:verify/);
    assert.match(policy, /published entr(?:y|ies)/i);
  }
  assert.match(agents, /same commit/i);
  assert.match(agents, /one logical feature per commit/i);
});
