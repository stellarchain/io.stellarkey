import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("new wallet setup asks whether every transaction needs a password", () => {
  const onboarding = read("src/components/Onboarding.tsx");

  assert.match(onboarding, /useState\(true\)/);
  assert.match(onboarding, />\s*Require password to sign\s*</);
  assert.match(onboarding, />\s*Recommended · Password required to disable\s*</);
  assert.doesNotMatch(onboarding, /Confirm your password before each transaction/);
  assert.match(onboarding, /label="Require password before signing transactions"/);
  assert.ok((onboarding.match(/requirePasswordForSigning/g) ?? []).length >= 6);
});

test("Signing Security exposes password rotation and protects policy disable", () => {
  const settings = read("src/components/SettingsPage.tsx");

  assert.match(settings, /label="Require Password to Sign"/);
  assert.match(settings, /label="Change Wallet Password"/);
  assert.match(
    settings,
    /changeSigningPasswordRequired\(false, disableSigningPassword\)/,
  );
  assert.match(settings, /title="Turn Off Password Confirmation\?"/);
  assert.match(settings, /label="Current Wallet Password"/);
  assert.match(settings, /title="Change Wallet Password"/);
  assert.match(settings, /autoComplete="current-password"/);
  assert.ok((settings.match(/autoComplete="new-password"/g) ?? []).length >= 2);
  assert.match(settings, /role="meter"/);
  assert.match(settings, /Existing Face ID or Touch ID[\s\S]*remains available/);
});
