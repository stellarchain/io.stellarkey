import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, root), "utf8");

test("the direct cipher dependency is the reviewed hardening release", () => {
  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));

  assert.equal(packageJson.dependencies["@noble/ciphers"], "^2.4.0");
  assert.equal(packageLock.packages[""].dependencies["@noble/ciphers"], "^2.4.0");
  assert.equal(packageLock.packages["node_modules/@noble/ciphers"].version, "2.4.0");
  assert.match(
    packageLock.packages["node_modules/@noble/ciphers"].integrity,
    /^sha512-[A-Za-z0-9+/]+=*$/,
  );
});

test("Dependabot proposes bounded weekly npm and Actions maintenance", () => {
  const path = new URL(".github/dependabot.yml", root);
  assert.equal(existsSync(path), true, ".github/dependabot.yml must exist");
  const config = read(".github/dependabot.yml");

  assert.match(config, /^version:\s*2\s*$/m);
  assert.equal((config.match(/package-ecosystem:\s*"npm"/g) ?? []).length, 1);
  assert.equal((config.match(/package-ecosystem:\s*"github-actions"/g) ?? []).length, 1);
  assert.equal((config.match(/directory:\s*"\/"/g) ?? []).length, 2);
  assert.equal((config.match(/interval:\s*"weekly"/g) ?? []).length, 2);
  assert.equal((config.match(/open-pull-requests-limit:\s*[1-9]\d*/g) ?? []).length, 2);
  assert.match(config, /day:\s*"monday"/);
  assert.match(config, /timezone:\s*"Europe\/London"/);
  assert.match(config, /groups:[\s\S]*non-major-production:[\s\S]*dependency-type:\s*"production"[\s\S]*update-types:\s*\["minor", "patch"\]/);
  assert.match(config, /groups:[\s\S]*non-major-development:[\s\S]*dependency-type:\s*"development"[\s\S]*update-types:\s*\["minor", "patch"\]/);
  assert.doesNotMatch(config, /automerge|auto-merge/i);
});

test("Dependabot keeps incompatible toolchain majors out of routine updates", () => {
  const config = read(".github/dependabot.yml");

  for (const dependency of ["typescript", "eslint", "@types/node"]) {
    const escapedDependency = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      config,
      new RegExp(
        `dependency-name:\\s*"${escapedDependency}"[\\s\\S]{0,120}update-types:\\s*\\["version-update:semver-major"\\]`,
      ),
      `${dependency} majors must wait for an explicit compatibility review`,
    );
  }
  assert.doesNotMatch(
    config,
    /^\s*-\s*"security"\s*$/m,
    "routine version updates must not be mislabeled as security fixes",
  );
});

test("every third-party workflow action is pinned to a full commit SHA", () => {
  const workflowDirectory = new URL(".github/workflows/", root);
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort();

  assert.ok(workflowFiles.length > 0);
  for (const name of workflowFiles) {
    const workflow = read(`.github/workflows/${name}`);
    const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    assert.ok(uses.length > 0, `${name} must contain at least one action`);
    for (const action of uses) {
      if (action.startsWith("./") || action.startsWith("docker://")) continue;
      assert.match(action, /@[0-9a-f]{40}$/i, `${action} in ${name} must be SHA-pinned`);
    }
  }
});

test("workflow JavaScript actions use reviewed Node 24 releases", () => {
  const workflows = ["ci.yml", "release.yml"]
    .map((name) => read(`.github/workflows/${name}`))
    .join("\n");

  const reviewedActions = new Map([
    ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
    ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
    ["actions/attest-build-provenance", "4d101475d8b20a2381f78447822ac1eab6504dd8"],
    ["cloudflare/wrangler-action", "ebbaa1584979971c8614a24965b4405ff95890e0"],
  ]);
  for (const [action, reviewedSha] of reviewedActions) {
    const references = [
      ...workflows.matchAll(new RegExp(`${action.replace("/", "\\/")}@([0-9a-f]{40})`, "g")),
    ].map((match) => match[1]);
    assert.ok(references.length > 0, `${action} must remain present in release automation`);
    assert.deepEqual(
      [...new Set(references)],
      [reviewedSha],
      `${action} must use its reviewed Node 24 release`,
    );
  }
  assert.doesNotMatch(workflows, /ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION/);
});

test("the production runbook covers repository-level security controls", () => {
  const deployment = read("docs/production-deployment.md");
  const checklist = read("docs/release-checklist.md");

  for (const requirement of [
    /CodeQL[^\n]*default setup/i,
    /Dependabot alerts/i,
    /secret scanning/i,
    /push protection/i,
    /protected[^\n]*main/i,
    /protected[^\n]*v\*/i,
    /production[^\n]*environment/i,
  ]) {
    assert.match(deployment, requirement);
  }
  assert.match(checklist, /repository security settings/i);
  assert.match(checklist, /production-deployment\.md/);
});
