import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { Legacy } from "@eslint/eslintrc";

const root = new URL("../", import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, root), "utf8");

test("ESLint's actual YAML adapter resolves the patched parser", () => {
  const require = createRequire(import.meta.url);
  const eslintRequire = createRequire(require.resolve("eslint/package.json"));
  const adapterRequire = createRequire(eslintRequire.resolve("@eslint/eslintrc"));
  const installed = adapterRequire("js-yaml/package.json");
  const [major, minor, patch] = installed.version.split(".").map(Number);
  assert.equal(major, 4, "parser major changes require explicit compatibility review");
  assert.ok(minor > 3 || (minor === 3 && patch >= 2), "ESLint must resolve js-yaml >=4.3.2");
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.packages["node_modules/js-yaml"].version, installed.version);
});

test("ESLint loads ordinary YAML config and rejects malformed YAML through its installed adapter", () => {
  const valid = new URL("tests/fixtures/eslint-valid.yaml", root);
  const invalid = new URL("tests/fixtures/eslint-invalid.yaml", root);
  const config = Legacy.loadConfigFile(valid.pathname);
  assert.deepEqual(config, { root: true, env: { browser: true, es2022: true }, rules: { "no-debugger": "error" } });
  const normalized = new Legacy.ConfigArrayFactory({ cwd: root.pathname }).loadFile(valid.pathname);
  assert.deepEqual(normalized.extractConfig(new URL("src/example.js", root).pathname).rules["no-debugger"], ["error"]);
  assert.throws(() => Legacy.loadConfigFile(invalid.pathname), /Cannot read config file|end of the stream|flow collection/);
});

test("application verification audits development dependencies as well as production", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(scripts["audit:all"], "npm audit --audit-level=high");
  assert.match(scripts["verify:application"], /npm run audit:prod && npm run audit:all/);
});

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

test("the supported type toolchain matches Node 22 and typescript-eslint", () => {
  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));

  assert.match(packageJson.devDependencies.typescript, /^\^6(?:\.|$)/);
  assert.match(packageJson.devDependencies["@types/node"], /^\^22(?:\.|$)/);
  assert.match(packageLock.packages["node_modules/typescript"].version, /^6\./);
  assert.match(packageLock.packages["node_modules/@types/node"].version, /^22\./);
});

test("Next.js telemetry is disabled for local and automated project commands", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.match(packageJson.scripts.dev, /^NEXT_TELEMETRY_DISABLED=1 next dev$/);
  assert.match(packageJson.scripts.build, /^NEXT_TELEMETRY_DISABLED=1 next build\b/);
  assert.match(read(".gitignore"), /^\.env\*$/m);
  assert.doesNotMatch(read(".gitignore"), /^!\.env$/m);
  assert.equal(existsSync(new URL(".env", root)), false, "environment files must stay untracked");


});

test("the production runbook covers repository-level security controls", () => {
  const deployment = read("docs/production-deployment.md");
  const checklist = read("docs/release-checklist.md");

  for (const requirement of [
    /CodeQL[^\n]*disabled/i,
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
