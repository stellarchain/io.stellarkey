import assert from "node:assert/strict";
import test from "node:test";

async function wakeLockDomain() {
  try {
    return await import("../src/hooks/useWakeLock.ts");
  } catch (error) {
    assert.fail(`The wake-lock controller is missing: ${error instanceof Error ? error.message : error}`);
  }
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

class FakeDocument extends EventTarget {
  visibilityState = "visible";

  setVisibility(next) {
    this.visibilityState = next;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

class FakeWakeLockSentinel extends EventTarget {
  released = false;
  releaseCalls = 0;

  async release() {
    if (this.released) return;
    this.releaseCalls += 1;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

test("foreground terminal wake lock acquires, releases while hidden, and reacquires on return", async () => {
  const { createWakeLockController } = await wakeLockDomain();
  const document = new FakeDocument();
  const sentinels = [];
  const states = [];
  let catchUps = 0;
  const navigator = {
    wakeLock: {
      async request(kind) {
        assert.equal(kind, "screen");
        const sentinel = new FakeWakeLockSentinel();
        sentinels.push(sentinel);
        return sentinel;
      },
    },
  };

  const controller = createWakeLockController({
    document,
    navigator,
    onStateChange: (state) => states.push(state),
    onForeground: () => { catchUps += 1; },
  });
  controller.start();
  await settle();
  assert.equal(controller.state(), "active");
  assert.equal(sentinels.length, 1);

  document.setVisibility("hidden");
  await settle();
  assert.equal(sentinels[0].releaseCalls, 1);
  assert.equal(controller.state(), "inactive");

  document.setVisibility("visible");
  await settle();
  assert.equal(catchUps, 1);
  assert.equal(sentinels.length, 2);
  assert.equal(controller.state(), "active");

  controller.stop();
  await settle();
  assert.equal(sentinels[1].releaseCalls, 1);
  assert.equal(controller.state(), "inactive");
  assert.ok(states.includes("requesting"));
  assert.ok(states.includes("active"));
});

test("unsupported browsers retain foreground catch-up without claiming wake protection", async () => {
  const { createWakeLockController } = await wakeLockDomain();
  const document = new FakeDocument();
  let catchUps = 0;
  const controller = createWakeLockController({
    document,
    navigator: {},
    onForeground: () => { catchUps += 1; },
  });

  controller.start();
  await settle();
  assert.equal(controller.state(), "unsupported");
  document.setVisibility("hidden");
  document.setVisibility("visible");
  await settle();
  assert.equal(catchUps, 1);
  assert.equal(controller.state(), "unsupported");
  controller.stop();
});

test("a late wake-lock result is released after the controller stops", async () => {
  const { createWakeLockController } = await wakeLockDomain();
  const document = new FakeDocument();
  const sentinel = new FakeWakeLockSentinel();
  let resolveRequest;
  const controller = createWakeLockController({
    document,
    navigator: {
      wakeLock: {
        request: () => new Promise((resolve) => { resolveRequest = resolve; }),
      },
    },
  });

  controller.start();
  controller.stop();
  resolveRequest(sentinel);
  await settle();
  assert.equal(sentinel.releaseCalls, 1);
  assert.equal(controller.state(), "inactive");
});
