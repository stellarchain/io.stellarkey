import { chromium } from "playwright";
import { open } from "./seed.mjs";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
const OVERLAY = readFileSync(new URL("./overlay.js", import.meta.url), "utf8");
const VIDEO = "/tmp/promo/probe-video";
rmSync(VIDEO, { recursive: true, force: true });
mkdirSync(VIDEO, { recursive: true });
const { ctx, p } = await open(chromium, { video: VIDEO });
p.setDefaultTimeout(8000);
await p.evaluate(OVERLAY);
const time = async (label, fn) => {
  const t = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, r) => setTimeout(() => r(new Error("HUNG")), 6000))]);
    console.log(`${label.padEnd(14)} ${Date.now() - t}ms`);
  } catch (e) {
    console.log(`${label.padEnd(14)} ${Date.now() - t}ms  ${String(e).slice(0, 40)}`);
  }
};
const call = (m, ...a) => p.evaluate(([mm, aa]) => window.__promo?.[mm]?.(...aa), [m, a]);
await time("has __promo", () => p.evaluate(() => typeof window.__promo));
await time("chapter", () => call("chapter", "X", "Hello there", "sub"));
await time("chapterOut", () => call("chapterOut"));
await time("tick", () => call("tick", 1, "The wallet", 0.1));
await time("caption", () => call("caption", "K", "Title", "Body text"));
await time("captionOut", () => call("captionOut"));
await time("clearNotes", () => call("clearNotes"));
await time("plain eval", () => p.evaluate(() => 1 + 1));
// The tour's real shape: several evaluates separated by real waits.
for (let i = 1; i <= 6; i++) {
  await time(`loop ${i} tick`, () => call("tick", i, "Section", i / 10));
  await time(`loop ${i} cap`, () => call("caption", "K", `Title ${i}`, "Body"));
  await p.waitForTimeout(3000);
  await time(`loop ${i} clr`, () => call("captionOut"));
}
await ctx.close();
