import assert from "node:assert/strict";
import test from "node:test";

import { openPaperWalletPrint } from "../src/lib/paperwallet.ts";

const paperWallet = {
  accountLabel: "Savings",
  publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  secretOrPhrase: "alpha beta gamma delta",
  kind: "mnemonic",
  pubQrDataUrl: "data:image/png;base64,public",
  secQrDataUrl: "data:image/png;base64,secret",
};

test("paper wallet blob URL is revoked as soon as the child document loads", (t) => {
  let loadHandler = null;
  const revoked = [];
  const child = {
    document: { readyState: "loading" },
    addEventListener(type, listener, options) {
      assert.equal(type, "load");
      assert.deepEqual(options, { once: true });
      loadHandler = listener;
    },
  };
  t.mock.method(URL, "createObjectURL", () => "blob:https://stellarkey.io/private-paper-wallet");
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  globalThis.window = { open: () => child };

  openPaperWalletPrint(paperWallet);
  assert.deepEqual(revoked, []);
  assert.equal(typeof loadHandler, "function");

  loadHandler();
  assert.deepEqual(revoked, ["blob:https://stellarkey.io/private-paper-wallet"]);
});

test("paper wallet blob URL is revoked immediately when the popup is blocked", (t) => {
  const revoked = [];
  t.mock.method(URL, "createObjectURL", () => "blob:https://stellarkey.io/blocked-paper-wallet");
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  t.mock.method(console, "error", () => undefined);
  globalThis.window = { open: () => null };

  openPaperWalletPrint(paperWallet);
  assert.deepEqual(revoked, ["blob:https://stellarkey.io/blocked-paper-wallet"]);
});
