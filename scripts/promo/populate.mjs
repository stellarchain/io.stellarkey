/**
 * Fills the surfaces the tour visits that a day of counter sales does not
 * touch: the address book and the invoice ledger. Empty states make weak
 * footage, and these are cheap to create through the real UI.
 */
import { chromium } from "playwright";
import * as Sdk from "@stellar/stellar-sdk";
import { open } from "./seed.mjs";
import { customer } from "./pay.mjs";

const { ctx, p } = await open(chromium, { viewport: { width: 1728, height: 1080 } });
p.setDefaultTimeout(7000);
const payer = await customer();
const btn = (re) => p.getByRole("button", { name: re }).first();
const esc = async () => {
  for (let i = 0; i < 8 && (await p.locator('[role="dialog"]').count()); i++) {
    await p.keyboard.press("Escape");
    await p.waitForTimeout(280);
  }
};

try {
  await btn(/^Wallet$/).click();
  await p.waitForTimeout(1100);
  await btn(/^Contacts$/).click();
  await p.waitForTimeout(1200);
  for (const [name, address] of [
    ["Alfama Bakery", Sdk.Keypair.random().publicKey()],
    ["Rua Coworking", Sdk.Keypair.random().publicKey()],
    ["Marta Coelho", payer.publicKey()],
  ]) {
    const add = p.locator("main button").filter({ hasText: /Add Your First Contact|Add Contact|New Contact/ }).first();
    if (!(await add.count())) break;
    await add.click();
    await p.waitForTimeout(800);
    await p.getByPlaceholder("e.g. Alice").first().fill(name);
    await p.getByPlaceholder("G...").first().fill(address);
    await p.waitForTimeout(250);
    await p.locator('[role="dialog"] button').filter({ hasText: /^Save Contact$/ }).first().click();
    await p.waitForTimeout(1000);
    console.log(`contact  ${name}`);
  }
  await esc();
} catch (err) {
  console.log("contacts —", String(err).split("\n")[0].slice(0, 80));
}

try {
  await btn(/^Merchant$/).click();
  await p.waitForTimeout(1300);
  await btn(/^Invoices$/).click();
  await p.waitForTimeout(1300);
  for (const [name, email, note] of [
    ["Praça Hotel", "contas@pracahotel.pt", "Weekly wholesale — beans and pastries."],
    ["Baixa Studio", "hello@baixastudio.pt", "Monthly coffee service."],
  ]) {
    const plus = p.locator("main button").filter({ hasText: /^\+$/ }).first();
    if (!(await plus.count())) { console.log("invoices — no + button"); break; }
    await plus.click();
    await p.waitForTimeout(1000);
    await p.getByPlaceholder("Praça Hotel").first().fill(name);
    await p.getByPlaceholder("contas@example.pt").first().fill(email);
    await p.getByPlaceholder("Monthly wholesale order.").first().fill(note);
    await p.waitForTimeout(300);
    const free = p.locator('[role="dialog"] button').filter({ hasText: /^Free-text line$/ }).first();
    if (await free.count()) {
      await free.click();
      await p.waitForTimeout(800);
      const inputs = p.locator('[role="dialog"] input');
      const n = await inputs.count();
      for (let i = 0; i < n; i++) {
        const f = inputs.nth(i);
        const ph = (await f.getAttribute("placeholder")) || "";
        if (/descri|item|line|name/i.test(ph) && !(await f.inputValue())) await f.fill("Wholesale beans, 5 kg");
        if (/0\.00|amount|price/i.test(ph) && !(await f.inputValue())) await f.fill("240.00");
      }
      await p.waitForTimeout(400);
    }
    const save = p.locator('[role="dialog"] button').filter({ hasText: /^Save draft$/ }).first();
    if ((await save.count()) && !(await save.isDisabled())) {
      await save.click();
      await p.waitForTimeout(1300);
      console.log(`invoice  ${name}`);
    } else {
      console.log(`invoice  ${name} — save unavailable`);
    }
    await esc();
  }
} catch (err) {
  console.log("invoices —", String(err).split("\n")[0].slice(0, 80));
}
await p.screenshot({ path: "/tmp/promo/populated.png" });
await ctx.close();
console.log("done");
