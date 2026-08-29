import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import nextConfig, { sourceTreeIsDirty } from "../next.config.ts";

const root = new URL("../", import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, root), "utf8");

function trackedTextFiles(relativePath) {
  const absolute = new URL(relativePath, root);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    return trackedTextFiles(path.posix.join(relativePath, entry.name));
  });
}

test("one canonical StellarKey identity drives production-facing surfaces", async () => {
  const brandUrl = new URL("src/lib/brand.ts", root);
  assert.equal(existsSync(brandUrl), true, "the canonical brand contract must exist");

  const brand = await import("../src/lib/brand.ts");
  assert.equal(brand.BRAND_NAME, "StellarKey");
  assert.equal(brand.BRAND_ORIGIN, "https://stellarkey.io");
  assert.equal(brand.SOURCE_REPOSITORY_URL, "https://github.com/stellarchain/io.stellarkey");
  assert.equal(brand.APPLICATION_VERSION, "1.0.0");
  assert.equal(brand.APPLICATION_VERSION, JSON.parse(read("package.json")).version);
  assert.match(nextConfig.env?.NEXT_PUBLIC_BUILD_COMMIT ?? "", /^[0-9a-f]{40}$/);
  assert.equal(brand.COPYRIGHT_OWNER, "StellarKey");
  assert.equal(brand.COPYRIGHT_YEAR, 2026);
  assert.match(brand.BRAND_DESCRIPTION, /self-custodial Stellar wallet/i);
  assert.equal(brand.decodeContactAddress("support"), ["support", "stellarkey", "io"].join("@").replace("@io", ".io"));
  assert.equal(brand.decodeContactAddress("security"), ["security", "stellarkey", "io"].join("@").replace("@io", ".io"));

  const layout = read("src/app/layout.tsx");
  const manifest = JSON.parse(read("src/app/manifest.webmanifest"));
  const hardware = read("src/lib/hardware.ts");
  const passkey = read("src/lib/passkey-prf.ts");
  const onboarding = read("src/components/Onboarding.tsx");
  const lock = read("src/components/LockScreen.tsx");
  const error = read("src/app/error.tsx");
  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));

  assert.match(layout, /metadataBase:\s*new URL\(BRAND_ORIGIN\)/);
  assert.match(layout, /applicationName:\s*BRAND_NAME/);
  assert.match(layout, /alternates:\s*\{[\s\S]*canonical:\s*"\/"/);
  assert.match(layout, /openGraph:/);
  assert.match(layout, /twitter:/);
  assert.match(layout, /codeRepository:\s*SOURCE_REPOSITORY_URL/);
  assert.match(read("src/components/PublicFooter.tsx"), /SOURCE_REPOSITORY_URL/);
  assert.match(read("src/app/about/page.tsx"), /SOURCE_COMMIT_URL/);
  assert.equal(manifest.name, "StellarKey — Self-custodial Stellar wallet");
  assert.equal(manifest.short_name, "StellarKey");
  assert.match(manifest.description, /Keys stay encrypted on your device/);
  assert.match(hardware, /appName:\s*BRAND_NAME/);
  assert.match(hardware, /appUrl:[\s\S]*BRAND_ORIGIN/);
  assert.match(hardware, /email:\s*decodeContactAddress\("support"\)/);
  assert.match(passkey, /rp:\s*\{\s*name:\s*BRAND_NAME\s*\}/);
  assert.match(onboarding, /\{BRAND_NAME\} · Self-custodial Stellar wallet/);
  assert.match(lock, />\{BRAND_NAME\}<\/h1>/);
  assert.match(error, /Reload \{BRAND_NAME\}/);
  assert.match(error, /<main[^>]*id="app-content"/);
  assert.equal(packageJson.name, "stellarkey");
  assert.equal(packageJson.version, "1.0.0");
  assert.equal(packageLock.name, "stellarkey");
  assert.equal(packageLock.packages[""].name, "stellarkey");
  assert.equal(packageLock.packages[""].version, "1.0.0");
  assert.match(read("src/lib/merchant/defaults.ts"), /appVersion: APPLICATION_VERSION/);
  assert.match(read("README.md"), /^# StellarKey$/m);
});

test("the desktop sidebar presents the larger borderless StellarKey identity", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  assert.match(dashboard, /<h1[^>]*>\s*\{BRAND_NAME\}\s*<\/h1>/);
  assert.match(dashboard, />\s*Self-Custody Wallet\s*</);
  assert.doesNotMatch(dashboard, />\s*Wallet\s*<\/h1>/);
  assert.doesNotMatch(dashboard, />\s*Stellar Self-Custody\s*</);
  assert.equal(dashboard.match(/<LogoMark size=\{30\} className="text-white" \/>/g)?.length, 2);
  assert.match(
    dashboard,
    /<div className="flex min-w-0 items-center gap-1\.5">\s*<LogoMark size=\{30\} className="text-white" \/>/,
  );
  assert.doesNotMatch(dashboard, /h-9 w-9[^\n]*border border-white\/10[^\n]*[\s\S]{0,120}<LogoMark/);
});

test("branded exports do not change encrypted compatibility contracts", () => {
  assert.match(read("src/components/BackupWizardModal.tsx"), /stellarkey-backup-/);
  assert.match(read("src/components/PaperWalletModal.tsx"), /stellarkey-/);
  assert.match(read("src/components/StorageRecoveryScreen.tsx"), /stellarkey-recovery-/);
  assert.match(read("src/components/AddressBookPage.tsx"), /stellarkey-contacts-/);
  assert.match(read("src/components/Dashboard.tsx"), /stellarkey-activity-/);
  assert.match(read("src/components/ReceiveModal.tsx"), /stellarkey-receive-qr\.png/);

  assert.match(read("src/lib/vault.ts"), /const BACKUP_KIND = "stellar-wallet-backup"/);
  assert.match(read("src/lib/vault.ts"), /const VAULT_KEY = "stellarkey\.vault\.v1"/);
  assert.match(read("src/lib/crypto.ts"), /const KDF_ITERATIONS = 600_000/);
  assert.match(read("src/lib/crypto.ts"), /wallet-vault-context-v1/);
  assert.match(read("public/sw.js"), /const CACHE_PREFIX = "stellarkey-shell-"/);
});

test("complete contact addresses are absent from tracked public source", () => {
  const support = ["support", "stellarkey", "io"].join("@").replace("@io", ".io");
  const security = ["security", "stellarkey", "io"].join("@").replace("@io", ".io");
  const files = [
    ...trackedTextFiles("src"),
    ...trackedTextFiles("public"),
    ...trackedTextFiles("docs"),
    new URL("README.md", root),
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, new RegExp(support, "i"), `${file.pathname} exposes the support mailbox`);
    assert.doesNotMatch(source, new RegExp(security, "i"), `${file.pathname} exposes the security mailbox`);
  }
});

test("release provenance rejects every nonignored untracked source input", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "stellarkey-provenance-"));
  const git = (...args) => execFileSync("git", args, { cwd: repository, stdio: "ignore" });

  try {
    git("init");
    git("config", "user.email", "release-test@example.invalid");
    git("config", "user.name", "Release Test");
    await writeFile(path.join(repository, "README.md"), "# Clean fixture\n");
    git("add", "README.md");
    git("commit", "-m", "fixture");
    assert.equal(sourceTreeIsDirty(repository), false);

    await mkdir(path.join(repository, "src", "app", "surprise"), { recursive: true });
    await writeFile(path.join(repository, "src", "app", "surprise", "page.tsx"), "export default function Page() {}\n");
    assert.equal(sourceTreeIsDirty(repository), true);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
