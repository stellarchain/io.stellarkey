import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Exercise the real component expressions without mounting a wallet or opening
// an external composer. Inputs are isolated, non-usable synthetic fixtures.
const source = readFileSync(new URL("../src/components/merchant/ReceiptSheet.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("ReceiptSheet.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
    && ["smsHref", "mailHref"].includes(node.name.text)) {
    assert.ok(node.initializer, "receipt draft URL must have an initializer");
    expressions.set(node.name.text, node.initializer.getText(file));
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.equal(expressions.size, 2, "both real receipt draft URL expressions must be tested");

const channels = [
  { name: "SMS", expression: "smsHref", protocol: "sms:", keys: ["body"], ordinary: "+44 7700 900123" },
  { name: "email", expression: "mailHref", protocol: "mailto:", keys: ["subject", "body"], ordinary: "receipt+test@example.invalid" },
];
const body = "Synthetic receipt &subject=not-a-header#fragment";
const subject = "Synthetic subject &bcc=not-a-header";

for (const channel of channels) {
  const build = new Function("phone", "email", "body", "subject",
    `return (${expressions.get(channel.expression)});`);
  const hrefFor = (recipient) => build(recipient, recipient, body, subject);

  test(`receipt ${channel.name} draft preserves ordinary recipients and query data`, () => {
    const href = hrefFor(`  ${channel.ordinary}  `);
    const url = new URL(href);
    assert.ok(href.startsWith(`${channel.protocol}${channel.ordinary}?`), "ordinary recipient formatting must remain unchanged");
    assert.equal(url.protocol, channel.protocol);
    assert.deepEqual([...url.searchParams.keys()], channel.keys);
    assert.ok(url.searchParams.get("body") === body, "receipt text must remain one body parameter");
    if (channel.expression === "mailHref") {
      assert.ok(url.searchParams.get("subject") === subject, "subject must remain one subject parameter");
    }
  });

  test(`receipt ${channel.name} recipient cannot append draft parameters or fragments`, () => {
    for (const recipient of [
      "recipient?bcc=extra@example.invalid&ignored=",
      "recipient?body=replaced&subject=replaced&ignored=",
      "recipient#hidden-fragment",
      "recipient%3Fbody%3Dreplaced",
    ]) {
      const url = new URL(hrefFor(recipient));
      assert.equal(url.protocol, channel.protocol);
      assert.deepEqual([...url.searchParams.keys()], channel.keys);
      assert.equal(url.hash, "");
      assert.ok(decodeURIComponent(url.pathname) === recipient, "recipient must remain path data");
      assert.ok(url.searchParams.get("body") === body, "recipient cannot replace receipt text");
    }
  });

  test(`receipt ${channel.name} recipient keeps markup encoded and its URI scheme fixed`, () => {
    for (const recipient of ["javascript:alert(1)", "\r\ndata:text/html,synthetic", '\"><svg/onload=synthetic>']) {
      const href = hrefFor(recipient);
      assert.equal(new URL(href).protocol, channel.protocol);
      assert.ok(!href.includes("<") && !href.includes('"'), "markup delimiters must remain encoded data");
    }
  });
}
