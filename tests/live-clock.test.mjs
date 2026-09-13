import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

async function clockDomain() {
  try {
    return await import("../src/hooks/useLiveNow.ts");
  } catch (error) {
    assert.fail(`The live clock hook is missing: ${error instanceof Error ? error.message : error}`);
  }
}

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("live clock snapshots advance only at their configured cadence", async () => {
  const { clockSnapshot } = await clockDomain();
  assert.equal(clockSnapshot(123_456, 1_000), 123_000);
  assert.equal(clockSnapshot(123_456, 60_000), 120_000);
  assert.throws(() => clockSnapshot(123, 0), /cadence/i);
});

test("the live clock refreshes when a suspended mobile page becomes visible", () => {
  const hook = source("src/hooks/useLiveNow.ts");
  assert.match(hook, /useSyncExternalStore/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /pageshow/);
});

test("merchant reports and time-sensitive screens do not freeze time at mount", () => {
  const merchant = source("src/hooks/useMerchant.tsx");
  const customers = source("src/components/merchant/CustomersPage.tsx");
  const links = source("src/components/merchant/PaymentLinksPage.tsx");
  const poster = source("src/components/merchant/CounterPosterModal.tsx");
  const customer = source("src/components/merchant/CustomerDetailModal.tsx");

  assert.match(merchant, /const reportingNow = useLiveNow\(/);
  for (const page of [customers, links, poster, customer]) {
    assert.match(page, /useLiveNow\(/);
    assert.doesNotMatch(page, /const \[now\] = useState\(\(\) => Date\.now\(\)\)/);
  }
});
