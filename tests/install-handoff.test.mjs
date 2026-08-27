import assert from "node:assert/strict";
import test from "node:test";

import {
  getInstallHandoff,
  isIosDevice,
  isStandaloneDisplay,
  shouldPrioritizeStandaloneRestore,
} from "../src/lib/install-handoff.ts";

test("standalone detection covers the web app display mode and legacy iOS flag", () => {
  assert.equal(isStandaloneDisplay({ displayModeStandalone: true }), true);
  assert.equal(isStandaloneDisplay({ navigatorStandalone: true }), true);
  assert.equal(
    isStandaloneDisplay({ displayModeStandalone: false, navigatorStandalone: false }),
    false,
  );
});

test("iOS detection includes iPhone and touch-capable iPad desktop mode", () => {
  assert.equal(
    isIosDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }),
    true,
  );
  assert.equal(isIosDevice({ platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isIosDevice({ userAgent: "Mozilla/5.0 (Linux; Android 15)" }), false);
});

test("an existing wallet must export an encrypted backup before app installation", () => {
  assert.deepEqual(
    getInstallHandoff({
      standalone: false,
      ios: true,
      nativePromptAvailable: false,
      backupExported: false,
    }),
    { available: true, action: "backup-first" },
  );
  assert.deepEqual(
    getInstallHandoff({
      standalone: false,
      ios: false,
      nativePromptAvailable: true,
      backupExported: false,
    }),
    { available: true, action: "backup-first" },
  );
});

test("a backed-up wallet uses iOS guidance or the native install prompt", () => {
  assert.deepEqual(
    getInstallHandoff({
      standalone: false,
      ios: true,
      nativePromptAvailable: false,
      backupExported: true,
    }),
    { available: true, action: "ios-guide" },
  );
  assert.deepEqual(
    getInstallHandoff({
      standalone: false,
      ios: false,
      nativePromptAvailable: true,
      backupExported: true,
    }),
    { available: true, action: "native-prompt" },
  );
});

test("install actions stay hidden when unavailable or already standalone", () => {
  assert.deepEqual(
    getInstallHandoff({
      standalone: true,
      ios: true,
      nativePromptAvailable: false,
      backupExported: true,
    }),
    { available: false, action: "hidden" },
  );
  assert.deepEqual(
    getInstallHandoff({
      standalone: false,
      ios: false,
      nativePromptAvailable: false,
      backupExported: true,
    }),
    { available: false, action: "hidden" },
  );
});

test("an empty standalone launch prioritizes recovery without changing browser onboarding", () => {
  assert.equal(shouldPrioritizeStandaloneRestore({ standalone: true, walletExists: false }), true);
  assert.equal(shouldPrioritizeStandaloneRestore({ standalone: false, walletExists: false }), false);
  assert.equal(shouldPrioritizeStandaloneRestore({ standalone: true, walletExists: true }), false);
});
