import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("merchant request surfaces expose consistent Standard and compatibility transport choices", () => {
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

test("charge request labels the MEMO_ID transport as Legacy", () => {
  const charge = source("src/components/merchant/ChargeSheet.tsx");

  assert.match(charge, /label: "Legacy", value: "memo-id"/);
  assert.doesNotMatch(charge, /label: "Trezor", value: "memo-id"/);
  assert.match(charge, /Legacy MEMO_ID/);
  assert.match(charge, /including Trezor/);
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

test("landing merchant copy explains muxed routing and the Trezor fallback", () => {
  const body = source("src/components/marketing/LandingBody.tsx");
  const panels = source("src/components/marketing/LandingPanels.tsx");

  assert.match(body, /muxed Stellar address/i);
  assert.match(body, /Trezor[\s\S]*MEMO_ID/i);
  assert.match(body, /no memo is required/i);
  assert.doesNotMatch(body, /The memo is the reconciliation/i);
  assert.doesNotMatch(body, /memo unique to this order/i);
  assert.doesNotMatch(body, /matched by<\/span><b>memo/i);
  assert.doesNotMatch(body, /Every sale with its payment, its ledger and its memo/i);
  assert.doesNotMatch(panels, /<span>Memo<\/span><b>NSC-O-1001<\/b>/i);
});
