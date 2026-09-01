import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPaperWalletHtml,
  closePaperWalletPrints,
  openPaperWalletPrint,
} from "../src/lib/paperwallet.ts";

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
  let printCalls = 0;
  const revoked = [];
  const child = {
    document: { readyState: "loading" },
    addEventListener(type, listener, options) {
      assert.equal(type, "load");
      assert.deepEqual(options, { once: true });
      loadHandler = listener;
    },
    print() {
      printCalls += 1;
    },
  };
  t.mock.method(URL, "createObjectURL", () => "blob:https://stellarkey.io/private-paper-wallet");
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  globalThis.window = { open: () => child };

  openPaperWalletPrint(paperWallet);
  assert.deepEqual(revoked, []);
  assert.equal(typeof loadHandler, "function");

  loadHandler();
  assert.equal(printCalls, 1);
  assert.deepEqual(revoked, ["blob:https://stellarkey.io/private-paper-wallet"]);
});

test("paper wallet HTML contains no CSP-blocked inline script", () => {
  assert.doesNotMatch(buildPaperWalletHtml(paperWallet), /<script\b/i);
});

test("paper wallet HTML escapes QR image attribute values", () => {
  const html = buildPaperWalletHtml({
    ...paperWallet,
    pubQrDataUrl: 'x" onerror="alert(1)',
    secQrDataUrl: 'y" onerror="alert(2)',
  });
  assert.doesNotMatch(html, /src="x" onerror=/);
  assert.doesNotMatch(html, /src="y" onerror=/);
});

test("tracked paper wallet windows close when the sensitive session ends", () => {
  let closeCalls = 0;
  const child = {
    closed: false,
    document: { readyState: "loading" },
    addEventListener() {},
    print() {},
    close() {
      closeCalls += 1;
      this.closed = true;
    },
  };
  globalThis.window = { open: () => child };

  openPaperWalletPrint(paperWallet);
  closePaperWalletPrints();
  assert.equal(closeCalls, 1);
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
