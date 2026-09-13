import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseChangelog } from '../src/lib/changelog.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('release preparation preserves the published 1.4.1-and-earlier notes byte for byte', () => {
  const source = read('CHANGELOG.md');
  const start = source.indexOf('## [1.4.1]');
  assert.ok(start >= 0);
  assert.equal(
    createHash('sha256').update(source.slice(start)).digest('hex'),
    '3937455e1f17fa421874da33e16c1e1e21bc744ad74eeb98a55f903f61474660',
    'Published notes may change only for an explicitly documented factual correction',
  );
});

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
  ];

  for (const [label, source] of invalid) {
    assert.throws(() => parseChangelog(source), undefined, label);
  }
});

test('the tracked changelog documents the current release', () => {
  assert.equal(existsSync(new URL('CHANGELOG.md', root)), true, 'CHANGELOG.md must exist');
  const source = read('CHANGELOG.md');
  const document = parseChangelog(source);

  assert.match(source, /^# Changelog$/m);
  assert.match(source, /keepachangelog\.com\/en\/1\.1\.0/i);
  assert.match(source, /semver\.org\/spec\/v2\.0\.0/i);
  assert.deepEqual(
    document.releases.map(({ version }) => version),
    ['Unreleased', '1.5.1', '1.5.0', '1.4.1', '1.4.0', '1.3.0', '1.2.0', '1.1.0', '1.0.0']
  );
  assert.deepEqual(document.releases[0].categories, []);
  const candidate = document.releases[1];
  assert.equal(candidate.version, '1.5.1');
  assert.equal(candidate.date, '2026-09-13');
  assert.deepEqual(candidate.categories.map(({ name }) => name), ['Added', 'Changed', 'Fixed']);
  const candidateNotes = candidate.categories.flatMap(({ entries }) => entries).join(' ');
  assert.match(candidateNotes, /Dark appearance/);
  assert.match(candidateNotes, /tree saturation/);
  assert.match(candidateNotes, /fresh state/);
  const release = document.releases[2];
  assert.equal(release.version, '1.5.0');
  assert.equal(release.date, '2026-09-12');
  assert.deepEqual(
    release.categories.map(({ name }) => name),
    ['Added', 'Changed', 'Removed', 'Fixed', 'Security']
  );
  assert.ok(release.categories.every(({ entries }) => entries.length > 0));
  const releaseNotes = release.categories.flatMap(({ entries }) => entries).join(' ');
  assert.match(releaseNotes, /System, Light and Dark/i);
  assert.match(releaseNotes, /submit directly.*RPC/i);
  assert.match(releaseNotes, /Testnet preview.*not a Mainnet/i);
  assert.match(releaseNotes, /js-yaml 4\.3\.2/i);
  // Keep the published historical-release assertions unchanged in scope.
  const historicalReleases = document.releases.filter(({ version }) => version !== release.version && version !== '1.5.1');
  assert.deepEqual(
    historicalReleases[1].categories.map(({ name }) => name),
    ['Changed', 'Fixed', 'Security']
  );
  assert.equal(historicalReleases[1].date, '2026-09-01');
  assert.ok(historicalReleases[1].categories.every(({ entries }) => entries.length > 0));
  const currentEntries = historicalReleases[1].categories.flatMap(({ entries }) => entries);
  assert.ok(currentEntries.length <= 24, 'public release notes should stay concise');
  assert.match(currentEntries.join(' '), /Private Payments.*production-hosted.*Testnet.*Mainnet/i);
  assert.match(currentEntries.join(' '), /unaudited.*testnet-preview.*audit/i);
  assert.deepEqual(
    historicalReleases[2].categories.map(({ name }) => name),
    ['Added', 'Changed', 'Fixed', 'Security']
  );
  assert.equal(historicalReleases[2].date, '2026-08-31');
  const previousEntries = historicalReleases[2].categories.flatMap(({ entries }) => entries);
  assert.match(previousEntries.join(' '), /USDT0.*Mainnet.*local logo/i);
  assert.match(previousEntries.join(' '), /version and build hash.*footer/i);
  assert.match(
    previousEntries.join(' '),
    /muxed.*MEMO_ID.*payment route/i
  );
  assert.deepEqual(
    historicalReleases[3].categories.map(({ name }) => name),
    ['Added', 'Changed', 'Fixed', 'Security', 'Removed']
  );
  assert.equal(historicalReleases[3].date, '2026-08-31');
  assert.match(
    historicalReleases[3].categories.flatMap(({ entries }) => entries).join(' '),
    /Private Payments.*testnet-only/i
  );
  assert.equal(historicalReleases[4].date, '2026-08-29');
  assert.match(
    historicalReleases[4].categories.flatMap(({ entries }) => entries).join(' '),
    /claimable.*display currency.*backup/i
  );
  assert.equal(historicalReleases[5].date, '2026-08-29');
  assert.match(
    historicalReleases[6].categories.flatMap(({ entries }) => entries).join(' '),
    /self-custody.*Trezor.*merchant/i
  );
});

test('all authoritative release markers agree on version 1.5.1', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const brand = read('src/lib/brand.ts');
  const security = read('SECURITY.md');
  const readme = read('README.md');

  assert.equal(packageJson.version, '1.5.1');
  assert.equal(packageLock.version, '1.5.1');
  assert.equal(packageLock.packages[''].version, '1.5.1');
  assert.match(brand, /APPLICATION_VERSION = "1\.5\.1"/);
  assert.match(security, /latest `1\.5\.x` release/i);
  assert.match(readme, /current release is `1\.5\.1`/i);
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
