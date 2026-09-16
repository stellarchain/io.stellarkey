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
  assert.deepEqual(document.releases.map(({ version }) => version), ['Unreleased', '1.0.4', '1.0.3', '1.0.2', '1.0.1', '1.0.0']);
  assert.deepEqual(document.releases[0], { version: 'Unreleased', date: null, categories: [] });
  assert.deepEqual(document.releases[1], {
    version: '1.0.4',
    date: '2026-09-16',
    categories: [{
      name: 'Fixed',
      entries: [
        "Cancel notification timers when banners are removed or replaced, without restarting the remaining banners' display or exit deadlines.",
        'Ignore service-worker registration results after their UI owner unmounts, preventing stale update prompts and leaked listeners.',
        'Keep the local production server running through malformed requests and unavailable build files, without serving the wallet without its generated security headers.',
        "Show the same payment reference in a new invoice's preview and saved draft.",
        'Keep invoice Open and Edit controls independently accessible by keyboard and touch, without nesting buttons or duplicating touch-target expansion.',
        'Keep merchant Insights comparisons and the live-hour chart aligned with local clock time across daylight-saving changes.',
      ],
    }, {
      name: 'Changed',
      entries: [
        'Reduce repeated work in merchant customer reconciliation and recent Insights calculations without caching customer or payment data.',
        'Check pinned Rust formatting during local, CI and release verification, and remove unused dependency licence allowances.',
        'Build the pinned circuit analyzer with its locked dependencies in CI and release checks.',
        'Run independent application, private UI and protocol verification jobs concurrently; publish the exact staged release only after every required gate succeeds.',
        'Split hosted private-component checks across isolated Chromium and iPhone WebKit runners without reducing coverage, and reject lint warnings during verification.',
        'Synchronize release markers and the whitepaper at 1.0.4, refreshing lockfile provenance without changing dependencies, Protocol V2 artifacts or the Testnet deployment.',
      ],
    }, {
      name: 'Security',
      entries: [
        "Record the maintainer's explicit continuation of the physical-device, VoiceOver/NVDA, passkey, Trezor and redistribution/origin sign-off deferral for 1.0.4. These checks are unperformed or unconfirmed, not passed; this exception grants no third-party license rights and does not approve real-value Private Payments.",
      ],
    }],
  });
  assert.equal(document.releases[2].date, '2026-09-14');
  assert.equal(document.releases[3].date, '2026-09-14');
  assert.equal(document.releases[4].date, '2026-09-13');
  assert.equal(document.releases[5].date, '2026-09-13');
  const notes = document.releases[5].categories.flatMap(({ entries }) => entries).join(' ');
  assert.match(notes, /stable starting application baseline/);
  assert.match(notes, /unaudited.*Testnet-only/);
  assert.match(notes, /GitHub Actions/);
  assert.match(notes, /history/);
  assert.match(source, /keepachangelog\.com/);
  assert.match(source, /semver\.org/);
});

test('all authoritative release markers agree on version 1.0.4', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const brand = read('src/lib/brand.ts');
  const security = read('SECURITY.md');
  const readme = read('README.md');

  assert.equal(packageJson.version, '1.0.4');
  assert.equal(packageLock.version, '1.0.4');
  assert.equal(packageLock.packages[''].version, '1.0.4');
  assert.match(brand, /APPLICATION_VERSION = "1\.0\.4"/);
  assert.match(security, /latest `1\.0\.x` release/i);
  assert.match(security, /current supported release is `1\.0\.4`/i);
  assert.match(readme, /current release is `1\.0\.4`/i);
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
