import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public trust pages disclose the backend-free browser privacy boundaries", () => {
  const security = read("src/app/security/page.tsx");
  const privacy = read("src/app/privacy/page.tsx");

  assert.match(security, /public (?:key|address).*label.*creation time/is);
  assert.match(security, /locked browser profile/is);
  assert.match(security, /full.*public ledger|public ledger.*full/is);
  assert.match(security, /connect-src.*https:/is);
  assert.match(security, /user-configurable.*endpoint|endpoint.*user-configurable/is);
  assert.match(security, /script-src.*hash|hash-bound.*script/is);
  assert.match(security, /issuer.*logo.*IP|logo.*issuer.*IP/is);
  assert.doesNotMatch(security, /This is the whole list\. Four addresses/);
  assert.doesNotMatch(security, /No fonts, scripts or images fetched from anyone else/);

  assert.match(privacy, /contacts.*encrypted|encrypted.*contacts/is);
  assert.match(privacy, /public (?:key|address).*label.*creation time/is);
  assert.match(privacy, /issuer.*logo.*IP|logo.*issuer.*IP/is);
});

test("merchant PIN UI states its per-window deterrence boundary", () => {
  const staff = read("src/components/merchant/StaffTerminalsPage.tsx");
  const security = read("src/app/security/page.tsx");

  for (const disclosure of [staff, security]) {
    assert.match(disclosure, /open (?:app )?window|per-window/i);
    assert.match(disclosure, /reset[\s\S]*reload|reload[\s\S]*reset/i);
    assert.match(disclosure, /cannot sign|cannot move money/i);
  }
  assert.match(staff, /local till deterrent/i);
});

test("Trezor 10 disclosures distinguish the installed client, development reference and hosted Suite core", () => {
  const security = read("src/app/security/page.tsx");
  const checklist = read("docs/release-checklist.md");
  const readme = read("README.md");
  const hardware = read("src/lib/hardware.ts");
  const packageJson = JSON.parse(read("package.json"));
  const combined = `${security}\n${checklist}\n${readme}`;

  assert.equal(packageJson.dependencies["@trezor/connect-web"], "^10.0.1");
  assert.equal(packageJson.dependencies["@trezor/connect-core"], undefined);
  assert.equal(packageJson.devDependencies["@trezor/connect-core"], "10.0.1");
  assert.equal(packageJson.overrides['@stellar/stellar-sdk@14.2.0'], undefined);
  assert.match(security, /zero vulnerable packages/i);
  assert.match(security, /reference.*development tests.*not bundled/is);
  assert.match(security, /do not establish.*deployed version.*hosted Suite service/is);
  assert.doesNotMatch(security, /ten low-severity|embedded parser remains vulnerable/i);
  assert.match(combined, /physical-device compatibility|physical-device checks/i);
  assert.match(combined, /high and critical.*release-blocking/is);
  assert.match(security, /optional.*laz(?:y|ily)|laz(?:y|ily).*optional/is);
  assert.match(hardware, /import\("@trezor\/connect-web"\)/);
});

test("release 1.1.0 records the fresh manual deferral without claiming a pass", () => {
  for (const source of [read("src/app/security/page.tsx"), read("docs/release-checklist.md")]) {
    assert.match(source, /(?:release 1\.1\.0|v1\.1\.0 release exception)/i);
    assert.match(source, /unperformed or unconfirmed,[\s\S]*?not passed/i);
    assert.match(source, /does not waive automated gates/i);
    assert.match(source, /does not approve real-value Private Payments/i);
  }
});
