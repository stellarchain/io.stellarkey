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

test("the remaining Trezor advisory boundary distinguishes package counts and remote code", () => {
  const security = read("src/app/security/page.tsx");
  const checklist = read("docs/release-checklist.md");
  const readme = read("README.md");
  const hardware = read("src/lib/hardware.ts");
  const packageJson = JSON.parse(read("package.json"));
  const combined = `${security}\n${checklist}\n${readme}`;

  assert.equal(packageJson.dependencies["@trezor/connect-web"], "^9.7.3");
  assert.ok(/ten low-severity vulnerable packages/.test(security), 'public security copy counts vulnerable packages');
  assert.ok(/one.*elliptic.*advisory/is.test(security), 'public security copy identifies the single remaining advisory');
  assert.ok(/override.*does not.*(?:prebundl|embedded).*remote/is.test(security), 'public security copy limits the override to installed dependencies');
  assert.doesNotMatch(security, /ten low-severity\s*<code>elliptic<\/code>\s*advisories/i);
  assert.match(combined, /Bitcoin|UTXO/i);
  assert.match(combined, /high and critical.*release-blocking/is);
  assert.match(security, /optional.*laz(?:y|ily)|laz(?:y|ily).*optional/is);
  assert.match(hardware, /import\("@trezor\/connect-web"\)/);
});
