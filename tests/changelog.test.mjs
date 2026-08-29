import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { parseChangelog } from "../src/lib/changelog.ts";

const root = new URL("../", import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, root), "utf8");

test("the constrained changelog parser preserves ordered release text", () => {
  const document = parseChangelog(`# Changelog

Introductory text may precede the releases.

## [Unreleased]

### Changed

- Future work stays visible.

## [1.1.0] - 2026-08-29

### Added

- A public release history.

### Security

- Stronger dependency governance.
`);

  assert.equal(document.title, "Changelog");
  assert.deepEqual(
    document.releases.map(({ version, date }) => ({ version, date })),
    [
      { version: "Unreleased", date: null },
      { version: "1.1.0", date: "2026-08-29" },
    ],
  );
  assert.deepEqual(document.releases[1].categories, [
    { name: "Added", entries: ["A public release history."] },
    { name: "Security", entries: ["Stronger dependency governance."] },
  ]);
  assert.equal(Object.isFrozen(document), true);
  assert.equal(Object.isFrozen(document.releases), true);
  assert.equal(Object.isFrozen(document.releases[1].categories[0].entries), true);
  assert.doesNotMatch(JSON.stringify(document), /<[^>]+>/);
});

test("the changelog parser rejects ambiguous or unsafe structure", () => {
  const invalid = [
    ["bullet before a category", "# Changelog\n## [Unreleased]\n- Orphaned entry"],
    [
      "duplicate release",
      "# Changelog\n## [Unreleased]\n### Changed\n- First\n## [Unreleased]\n### Changed\n- Second",
    ],
    ["malformed date", "# Changelog\n## [1.1.0] - 2026-02-30\n### Added\n- Entry"],
    ["raw HTML", "# Changelog\n<script>alert(1)</script>\n## [Unreleased]\n### Changed\n- Entry"],
    ["unsupported category", "# Changelog\n## [Unreleased]\n### Misc\n- Entry"],
    ["empty published release", "# Changelog\n## [1.1.0] - 2026-08-29"],
  ];

  for (const [label, source] of invalid) {
    assert.throws(() => parseChangelog(source), undefined, label);
  }
});

test("the tracked changelog documents the current release", () => {
  assert.equal(existsSync(new URL("CHANGELOG.md", root)), true, "CHANGELOG.md must exist");
  const source = read("CHANGELOG.md");
  const document = parseChangelog(source);

  assert.match(source, /^# Changelog$/m);
  assert.match(source, /keepachangelog\.com\/en\/1\.1\.0/i);
  assert.match(source, /semver\.org\/spec\/v2\.0\.0/i);
  assert.deepEqual(
    document.releases.map(({ version }) => version),
    ["Unreleased", "1.1.0", "1.0.0"],
  );
  assert.deepEqual(document.releases[0].categories, []);
  assert.deepEqual(
    document.releases[1].categories.map(({ name }) => name),
    ["Added", "Changed", "Fixed", "Security", "Removed"],
  );
  assert.equal(document.releases[1].date, "2026-08-29");
  assert.ok(document.releases[1].categories.every(({ entries }) => entries.length > 0));
  assert.equal(document.releases[2].date, "2026-08-28");
  assert.match(
    document.releases[2].categories.flatMap(({ entries }) => entries).join(" "),
    /self-custody.*Trezor.*merchant/i,
  );
});

test("all authoritative release markers agree on version 1.1.0", () => {
  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));
  const brand = read("src/lib/brand.ts");
  const security = read("SECURITY.md");
  const readme = read("README.md");

  assert.equal(packageJson.version, "1.1.0");
  assert.equal(packageLock.version, "1.1.0");
  assert.equal(packageLock.packages[""].version, "1.1.0");
  assert.match(brand, /APPLICATION_VERSION = "1\.1\.0"/);
  assert.match(security, /latest `1\.1\.x` release/i);
  assert.match(readme, /current release is `1\.1\.0`/i);
  assert.match(readme, /\[changelog\]\(CHANGELOG\.md\)/i);
});

test("agent and contributor policies keep version history synchronized", () => {
  const agents = read("AGENTS.md");
  const contributing = read("CONTRIBUTING.md");

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
