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
  assert.deepEqual(document.releases.map(({ version }) => version), ['Unreleased', '1.1.2', '1.1.1', '1.1.0', '1.0.5', '1.0.4', '1.0.3', '1.0.2', '1.0.1', '1.0.0']);
  assert.deepEqual(document.releases[0], { version: "Unreleased", date: null, categories: [] });
  assert.deepEqual(document.releases[1], {
  "version": "1.1.2",
  "date": "2026-11-06",
  "categories": [
    {
      "name": "Changed",
      "entries": [
        "Prepare application release 1.1.2 as the replacement for unpublished 1.1.1; synchronize version markers and the whitepaper."
      ]
    },
    {
      "name": "Fixed",
      "entries": [
        "Wait for synthetic wallet bootstrap and owned fixture readiness before browser checks, with a 30-second bootstrap bound and unchanged modal assertions, retries, and capture restrictions."
      ]
    },
    {
      "name": "Security",
      "entries": [
        "Continue the maintainer-approved manual-check deferral and exact RUSTSEC-2026-0387 exception for this replacement; the checks remain unperformed or unconfirmed and the advisory remains unresolved."
      ]
    }
  ]
});
  assert.deepEqual(document.releases[2], {
  "version": "1.1.1",
  "date": "2026-11-06",
  "categories": [
    {
      "name": "Changed",
      "entries": [
        "Replace the unpublished 1.1.0 candidate after release verification exposed a dialog focus race; synchronize application versions and the whitepaper at 1.1.1.",
        "Update Next.js and its lint configuration to 16.4.5, Stellar SDK to 17.4.0 for the app and installed Trezor adapter, and Tailwind CSS to 4.3.4; refresh current artifact provenance without changing cryptographic artifacts or historical deployment bindings.",
        "Animate only the changing properties on onboarding and address-book controls.",
        "Run the complete hosted browser gates on standard macOS Intel runners after ARM capacity failures, retaining canonical artifact reproduction on macOS ARM64."
      ]
    },
    {
      "name": "Fixed",
      "entries": [
        "Preserve focus in Select and menu portals when a dialog’s delayed initial focus runs after keyboard interaction.",
        "Announce incomplete erasure and initialize focus on its recovery heading when no newer control owns focus.",
        "Label zero-limit trustline operations as removals in wallet activity.",
        "Keep signing disabled and show an explicit retry screen when wallet erasure leaves storage, merchant records, private records, service workers, or caches uncleared.",
        "Revalidate the reviewed wallet account, network, and session across batch payments, claims, merges, trustlines, multisig changes, co-signing, and reusable private payments before signing and submission.",
        "Keep refresh callbacks bound to the visible account, network, and endpoint, remove redundant delayed refreshes, and release failed transaction-status polls for retry.",
        "Bound Friendbot requests and error bodies, and time out stalled verified Private Payments artifact downloads without rejecting slow transfers that keep making progress.",
        "Pin and verify the official Intel macOS Stellar CLI 27.0.0 archive used by hosted browser verification."
      ]
    },
    {
      "name": "Security",
      "entries": [
        "Retain the maintainer-approved manual-check deferral and exact RUSTSEC-2026-0387 exception for the replacement candidate; the checks remain unperformed or unconfirmed and the advisory remains unresolved."
      ]
    }
  ]
});
  assert.deepEqual(document.releases[3], {
  "version": "1.1.0",
  "date": "2026-11-06",
  "categories": [
    {
      "name": "Changed",
      "entries": [
        "Update the pinned Cloudflare Wrangler action to 4.1.3 and retain its reviewed Node 24 runtime requirement.",
        "Update Next.js and its lint configuration to 16.4.2, React to 19.3.1, Stellar SDK to 17.3.0, and the browser test toolchain.",
        "Migrate optional hardware signing to Trezor Connect 10.0.1 and Suite Web, with the matching bootstrap-frame policy and device-protocol compatibility tests. The Suite core remains hosted by Trezor; its reference implementation is a development-only test dependency.",
        "Prepare application release 1.1.0 with synchronized version markers and whitepaper; Private Payments remains the V2.1 development protocol.",
        "Refresh the pinned Node setup and artifact upload/download Actions used by CI and release verification."
      ]
    },
    {
      "name": "Fixed",
      "entries": [
        "Run the complete browser verification matrix on macOS with Playwright 1.65.0, preserving native animation checks despite Linux WebKit rendering regressions.",
        "Pin hosted circuit analysis to Ubuntu 24.04 and GCC 12 so the unchanged legacy Z3 dependency builds after the ubuntu-latest image migration.",
        "Refresh Private Balance build provenance while preserving the historical deployment lock and binding current browser maintenance inputs.",
        "Retain custom credential-header protection across JavaScript realms during HTTP redirects and correct IPv6 link-local and cross-family subnet classification in installed dependencies.",
        "Set the CMake compatibility policy for the pinned circuit analyzer's legacy Z3 build on hosted runners.",
        "Match wallet and merchant control accessible names to their visible labels and values."
      ]
    },
    {
      "name": "Security",
      "entries": [
        "Apply compatible Axios, image-processing, source-map, TOML, PBKDF2 and brace-expansion patches, preserving the strict HPKE deployment-history checks.",
        "Preserve the reviewed recursion-depth guard in Next.js lint dependencies and check every public signal in the twelve-signal Rust verifier mutation suite.",
        "Update Rust constant-time utilities to ctutils 0.4.4 without changing the deployed pool Wasm.",
        "Record the maintainer-approved 1.1.0 exception for RUSTSEC-2026-0387 in Soroban host dependencies. The crypto-bigint advisory remains unresolved.",
        "Record the maintainer’s explicit 1.1.0 deferral of physical-device, VoiceOver/NVDA, passkey, Trezor and redistribution/origin sign-off checks. They remain unperformed or unconfirmed, not passed; this grants no third-party license rights or approval for real-value Private Payments."
      ]
    }
  ]
});
  assert.deepEqual(document.releases[4], {
    version: '1.0.5', date: '2026-09-22',
    categories: [
      { name: 'Changed', entries: [
        'Prepare application release 1.0.5 with synchronized version markers and whitepaper; name the Private Payments protocol release V2.1 while retaining encoded protocol identifier 3.',
        'Private Payments Protocol V2.1 uses one entrypoint and archive-record shape with proof-bound public inflow, outflow, and append fields. Ordinary withdrawals append three commitments even when no private change remains. At verified tree saturation, exact-input withdrawals can skip appending; these capacity exits remain publicly distinguishable. Boundary deposits and withdrawals remain public, and every action persists both nullifiers.',
        'Raise the maximum reviewed private-action resource fee from 1 XLM to 2 XLM for the V2.1 development pool; the separate classic inclusion fee and explicit approval remain in force.',
      ] },
      { name: 'Security', entries: [
        'Remove published action-kind labels and the normal-wallet append distinction between exact-input and change-producing withdrawals. Match the fresh capacity counter to the authenticated checkpoint before choosing exit mode, and reject a worker or withdrawal-chain review that changes the expected append policy.',
      ] },
      { name: 'Removed', entries: [
        'Removed the published action kind from proofs, the pool contract entrypoints, and the authenticated archive records. Current clients support only the replacement V2.1 development pool; V2 deployment-bound notes, addresses, proofs, and encrypted backups are rejected rather than migrated.',
      ] },
      { name: 'Fixed', entries: [
        'Verify that independently rebuilt R1CS, witness Wasm, and pool Wasm match the checked-in artifacts and published manifest hashes.',
        'Explain incompatible or damaged Private Payments backup records without exposing their contents, and preserve the existing wallet when validation fails. Public-only backups remain compatible.',
        'Derive V2.1 backup storage keys correctly during import. Encrypt new V2.1 recipient envelopes with the V2.1 HPKE context while retaining authenticated recovery of early V2.1 development envelopes written with the V2 HPKE context. Obsolete V2 note plaintexts remain rejected.',
        'Validate V2.1 proof-vector metadata and restore the security-constraint mutation checks after the circuit migration.',
        'Stop offering an already-loaded release after a refresh, reconcile stale offline-worker update banners, and make stalled activation retryable without clearing wallet data or forcing other open tabs to reload.',
      ] },
    ],
  });
  assert.deepEqual(document.releases[5], {
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
        'Keep local-currency network-fee labels readable on raised dark review surfaces.',
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
  assert.equal(document.releases[6].date, '2026-09-14');
  assert.equal(document.releases[7].date, '2026-09-14');
  assert.equal(document.releases[8].date, '2026-09-13');
  assert.equal(document.releases[9].date, '2026-09-13');
  const notes = document.releases[9].categories.flatMap(({ entries }) => entries).join(' ');
  assert.match(notes, /stable starting application baseline/);
  assert.match(notes, /unaudited.*Testnet-only/);
  assert.match(notes, /GitHub Actions/);
  assert.match(notes, /history/);
  assert.match(source, /keepachangelog\.com/);
  assert.match(source, /semver\.org/);
});

test('all authoritative release markers agree on version 1.1.2', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const brand = read('src/lib/brand.ts');
  const security = read('SECURITY.md');
  const readme = read('README.md');

  assert.equal(packageJson.version, '1.1.2');
  assert.equal(packageLock.version, '1.1.2');
  assert.equal(packageLock.packages[''].version, '1.1.2');
  assert.match(brand, /APPLICATION_VERSION = "1\.1\.2"/);
  assert.match(security, /latest `1\.1\.x` release/i);
  assert.match(security, /current release is `1\.1\.2`/i);
  assert.match(security, /`1\.1\.x` release/);
  assert.match(readme, /current release is `1\.1\.2`/i);
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
