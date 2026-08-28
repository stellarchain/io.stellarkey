import { chromium } from "playwright";
import { PROFILE, BASE } from "./seed.mjs";
const ctx = await chromium.launchPersistentContext(PROFILE, { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? (await ctx.newPage());
await p.goto(BASE, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
console.log(await p.evaluate(async () => {
  const out = { localStorage: {}, idb: [] };
  for (const [k, v] of Object.entries(localStorage)) {
    out.localStorage[k] = k.includes("vault") ? `version=${(() => { try { return JSON.parse(v).version; } catch { return "?"; } })()} len=${v.length}` : String(v).slice(0, 60);
  }
  if (indexedDB.databases) {
    for (const d of await indexedDB.databases()) out.idb.push(`${d.name} v${d.version}`);
  }
  return out;
}));
await ctx.close();
