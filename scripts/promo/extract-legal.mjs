/** Pulls the real rendered content out of each legal page's static HTML. */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const PAGES = ["about", "privacy", "terms", "security", "support"];
const b = await chromium.launch();
const p = await b.newPage();
const out = {};
for (const name of PAGES) {
  const html = readFileSync(`out/${name}.html`, "utf8");
  await p.setContent(html, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(150);
  out[name] = await p.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const grab = (sel) => [...main.querySelectorAll(sel)];
    const eyebrow = main.querySelector("p,span")?.textContent?.trim() || "";
    const h1 = main.querySelector("h1")?.textContent?.trim() || "";
    // the lede is the first substantial paragraph before any h2
    const firstH2 = main.querySelector("h2");
    const paras = grab("p").filter((el) => (el.textContent || "").trim().length > 60);
    const summary = paras[0]?.textContent?.trim() || "";
    const highlights = grab("li").map((el) => (el.textContent || "").trim())
      .filter((t) => t.length > 40 && t.length < 260).slice(0, 3);
    const sections = grab("section").map((sec) => ({
      id: sec.id || "",
      h: sec.querySelector("h2")?.textContent?.trim() || "",
      blocks: [...sec.children].filter((el) => el.tagName !== "H2").map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        items: el.tagName === "OL" || el.tagName === "UL"
          ? [...el.querySelectorAll("li")].map((li) => (li.textContent || "").replace(/\s+/g, " ").trim())
          : [],
      })).filter((x) => x.text.length > 2),
    })).filter((s) => s.h);
    void firstH2; void eyebrow;
    return { h1, summary, highlights, sections };
  });
  console.log(`${name.padEnd(9)} "${out[name].h1}" · ${out[name].sections.length} sections · ${out[name].highlights.length} highlights`);
}
await b.close();
writeFileSync("/tmp/promo/legal.json", JSON.stringify(out, null, 1));
