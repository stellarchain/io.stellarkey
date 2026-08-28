/**
 * The tour driver: everything a beat needs, bound to one page.
 *
 * Kept apart from the tour itself because the film is shot in two passes — a
 * desktop context and a phone context — and each needs its own page, its own
 * video and its own driver, but the same vocabulary.
 */
import { appendFileSync } from "node:fs";

export function makeDriver(p, { log, overlay, phone = false }) {
  const ui = (fn, ...args) => p.evaluate(fn, ...args);
  const promo = (method, ...args) =>
    p.evaluate(([m, a]) => window.__promo?.[m]?.(...a), [method, args]);
  const wait = (ms) => p.waitForTimeout(ms);

  /** Targets are resolved here: the tour's selectors are Playwright's, not CSS. */
  async function rect(target) {
    const loc = typeof target === "string" ? p.locator(target).first() : target;
    const box = await loc.boundingBox().catch(() => null);
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
  }

  const note = async (target, k, t, b, side) => promo("note", await rect(target), k, t, b, side);
  const caption = (k, t, b) => promo("caption", k, t, b);
  const clear = async () => {
    await promo("captionOut");
    await promo("clearNotes");
  };

  async function tap(target, { settle = 700 } = {}) {
    const loc = typeof target === "string" ? p.locator(target).first() : target;
    // On a phone the target is often below the fold; the cursor has to be
    // pointed at where the element actually ends up, not where it started.
    await loc.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    await promo("point", await rect(loc));
    await wait(340);
    await promo("click");
    await wait(110);
    await loc.click({ timeout: 7000 }).catch(async () => {
      await loc.click({ force: true, timeout: 3500 });
    });
    await promo("pointOff");
    await wait(settle);
  }

  /** Dismiss whatever is open, so the next beat starts from a clean screen. */
  async function escape(n = 6) {
    for (let i = 0; i < n && (await p.locator('[role="dialog"]').count()); i++) {
      await p.keyboard.press("Escape").catch(() => {});
      await wait(280);
    }
  }

  const beats = [];
  const CAP_MS = 40000;
  async function beat(name, fn) {
    const started = Date.now();
    log(`→ ${name}`);
    let timer;
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`beat "${name}" exceeded ${CAP_MS / 1000}s`)), CAP_MS);
        }),
      ]);
      beats.push({ name, ok: true, s: (Date.now() - started) / 1000 });
      log(`✓ ${name}`);
    } catch (err) {
      const msg = String(err).split("\n")[0];
      beats.push({ name, ok: false, s: (Date.now() - started) / 1000, err: msg });
      log(`✗ ${name} — ${msg.slice(0, 88)}`);
      await clear().catch(() => {});
      await promo("spotOff").catch(() => {});
      await escape().catch(() => {});
    } finally {
      clearTimeout(timer);
    }
  }

  const install = async () => {
    await ui(overlay);
    if (phone) await promo("phone", true);
  };

  const side = (label) => p.getByRole("button", { name: new RegExp(`^${label}`) }).first();

  return { ui, promo, wait, rect, note, caption, clear, tap, escape, beat, beats, install, side, p };
}

export function makeLogger(path, t0) {
  return (m) => {
    const at = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
    const line = `  ${at}s  ${m}`;
    console.log(line);
    appendFileSync(path, line + "\n");
  };
}
