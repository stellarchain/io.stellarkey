import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("merchant request surfaces expose one consistent Standard and Trezor transport choice", () => {
  const hook = source("src/hooks/useMerchant.tsx");
  const charge = source("src/components/merchant/ChargeSheet.tsx");
  const invoice = source("src/components/merchant/InvoiceDetailModal.tsx");
  const poster = source("src/components/merchant/CounterPosterModal.tsx");

  assert.match(hook, /chargeCompatibilityPayUri/);
  assert.match(hook, /invoiceCompatibilityPayUri/);
  assert.match(hook, /counterCodeCompatibilityPayUri/);

  for (const surface of [charge, invoice, poster]) {
    assert.match(surface, /Standard/);
    assert.match(surface, /Trezor/);
    assert.match(surface, /requestTransport/);
  }
});

test("merchant payment instructions describe routing without requiring a human text memo", () => {
  const surfaces = [
    source("src/components/merchant/ChargeSheet.tsx"),
    source("src/components/merchant/InvoiceDetailModal.tsx"),
    source("src/components/merchant/CounterPosterModal.tsx"),
  ].join("\n");

  assert.doesNotMatch(surfaces, /Memo — must not be removed/i);
  assert.doesNotMatch(surfaces, /Quote this reference as the payment memo/i);
  assert.match(surfaces, /payment route/i);
});
