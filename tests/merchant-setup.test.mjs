import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import {
  completeMerchantSetup,
  needsMerchantSetup,
} from "../src/lib/merchant/setup.ts";

const PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const CREDENTIAL =
  "pbkdf2-sha256$v1$600000$AAECAwQFBgcICQoLDA0ODw==$AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

function validSetup(overrides = {}) {
  return {
    profile: {
      name: " North Star Coffee ",
      addressLines: [" 12 High Street ", "", " London "],
      taxId: " GB123 ",
      receiptFooter: " Thank you ",
    },
    receivingPublicKey: PUBLIC_KEY,
    settlementAsset: { code: "USDC", issuer: USDC_ISSUER },
    acceptedAssets: [
      { code: "XLM", issuer: null },
      { code: "USDC", issuer: USDC_ISSUER },
    ],
    currency: "GBP",
    taxMode: "inclusive",
    taxRates: [
      { id: "standard", label: "Standard", percent: 20 },
      { id: "zero", label: "Zero", percent: 0 },
    ],
    tips: {
      mode: "percent",
      percents: [10, 15, 20],
      fixedMinor: [50, 100],
      thresholdMinor: 1000,
      onNet: true,
    },
    chargeExpirySeconds: 600,
    terminalName: " Front counter ",
    textSize: "large",
    ownerName: "Ari",
    pinDigest: CREDENTIAL,
    ...overrides,
  };
}

test("an unconfigured store needs setup and cancelling leaves it disabled", () => {
  const store = emptyStore();
  const before = structuredClone(store);
  assert.equal(needsMerchantSetup(store.settings, store.staff), true);
  assert.equal(store.settings.enabled, false);
  assert.deepEqual(store, before);
});

test("setup commits the complete till configuration and owner atomically", () => {
  const original = {
    ...emptyStore(),
    orders: [{ id: "existing-order" }],
  };
  const result = completeMerchantSetup(original, validSetup(), {
    now: 1_700_000_000_000,
    ownerId: "staff-owner",
  });

  assert.notEqual(result, original);
  assert.equal(result.settings.enabled, true);
  assert.equal(result.settings.profile.name, "North Star Coffee");
  assert.deepEqual(result.settings.profile.addressLines, ["12 High Street", "London"]);
  assert.equal(result.settings.profile.taxId, "GB123");
  assert.equal(result.settings.profile.receiptFooter, "Thank you");
  assert.equal(result.settings.receivingPublicKey, PUBLIC_KEY);
  assert.equal(result.settings.currency, "GBP");
  assert.equal(result.settings.defaultTaxRateId, "standard");
  assert.equal(result.settings.terminalName, "Front counter");
  assert.equal(result.terminal.name, "Front counter");
  assert.equal(result.tillTextSize, "large");
  assert.equal(result.staff.length, 1);
  assert.deepEqual(
    result.staff[0],
    {
      id: "staff-owner",
      name: "Ari",
      role: "owner",
      permissions: {
        takePayment: true,
        applyDiscount: true,
        comp: true,
        void: true,
        refundCeilingMinor: null,
        openDrawer: true,
        seeReports: true,
        exportRecords: true,
      },
      pinDigest: CREDENTIAL,
      pinSetAt: 1_700_000_000_000,
      active: true,
    },
  );
  assert.equal(result.activeStaffId, "staff-owner");
  assert.deepEqual(result.orders, original.orders);
  assert.equal(needsMerchantSetup(result.settings, result.staff), false);
  assert.equal(original.settings.enabled, false);
  assert.deepEqual(original.staff, []);
});

test("editing setup updates the owner without erasing operational records", () => {
  const initial = completeMerchantSetup(emptyStore(), validSetup(), {
    now: 100,
    ownerId: "owner-1",
  });
  const withHistory = {
    ...initial,
    nextOrderNumber: 1234,
    adjustments: [
      {
        id: "adjustment-1",
        kind: "discount",
        orderNumber: 1233,
        lineName: null,
        amountMinor: 100,
        reasonCode: "promo",
        staffName: "Ari",
        at: 150,
      },
    ],
  };

  const updated = completeMerchantSetup(
    withHistory,
    validSetup({ ownerName: "Alex", terminalName: "Back counter" }),
    { now: 200, ownerId: "ignored-new-id" },
  );
  assert.equal(updated.staff.length, 1);
  assert.equal(updated.staff[0].id, "owner-1");
  assert.equal(updated.staff[0].name, "Alex");
  assert.equal(updated.staff[0].pinSetAt, 200);
  assert.equal(updated.nextOrderNumber, 1234);
  assert.deepEqual(updated.adjustments, withHistory.adjustments);
});

test("invalid setup is rejected before any store mutation", () => {
  const invalid = [
    validSetup({ profile: { ...validSetup().profile, name: "   " } }),
    validSetup({ receivingPublicKey: "not-an-account" }),
    validSetup({ acceptedAssets: [] }),
    validSetup({ settlementAsset: { code: "EURC", issuer: USDC_ISSUER } }),
    validSetup({ taxRates: [{ id: "bad", label: "Bad", percent: 101 }] }),
    validSetup({ terminalName: "" }),
    validSetup({ pinDigest: "4826" }),
  ];

  for (const input of invalid) {
    const store = emptyStore();
    const before = structuredClone(store);
    assert.throws(() => completeMerchantSetup(store, input, { now: 1, ownerId: "owner" }));
    assert.deepEqual(store, before);
  }
});

test("the setup UI signs trustlines and commits real state without mock success paths", () => {
  const wizard = readFileSync(
    new URL("../src/components/merchant/SetupWizard.tsx", import.meta.url),
    "utf8",
  );
  const settings = readFileSync(
    new URL("../src/components/SettingsPage.tsx", import.meta.url),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../src/components/Dashboard.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(wizard, /merchant\/mock|Nothing saved|Would sign a ChangeTrust/);
  assert.match(wizard, /await trustAsset\(/);
  assert.match(wizard, /await completeSetup\(/);
  assert.match(settings, /else if \(!merchantConfigured\)/);
  assert.match(settings, /onOpenSetupWizard\?\.\(\)/);
  assert.match(dashboard, /onComplete=\{\(\) => switchTab\("merchant"\)\}/);
});
