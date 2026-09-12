import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
} from "./fixtures";

// The suite-wide default is Reduce Motion so animation never gates other
// tests. This file exercises the motion contract itself, so it opts back in
// and separately checks the reduced-motion crossfade.

declare global {
  interface Window {
    __resumeModalFrames?: () => void;
    __modalExit?: {
      sawClosing: boolean;
      closingFrames: number;
      before: { width: number; height: number };
      min: { width: number; height: number };
      closingAnimation: string;
      openAnimation: string;
    };
  }
}

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

async function openSend(page: Page): Promise<Locator> {
  const trigger = page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Send Payment", exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((node) => node.getAttribute("data-overlay-state"))).toBe("open");
  // Let the entrance settle so geometry reflects the resting sheet or card.
  await dialog.evaluate(async (node) => {
    const shell = (node as HTMLElement).querySelector<HTMLElement>("[data-modal-shell]");
    await Promise.all([node, shell].flatMap((element) => element?.getAnimations().map((animation) => animation.finished.catch(() => undefined)) ?? []));
  });
  return dialog;
}

/** Observes the exit: closing state, geometry samples every frame, and the animation names. */
async function observeExit(dialog: Locator): Promise<void> {
  await dialog.evaluate((node) => {
    const backdrop = node as HTMLElement;
    const shell = backdrop.querySelector<HTMLElement>("[data-modal-shell]");
    if (!shell) throw new Error("dialog shell missing");
    // Layout size: the exit animation scales the box, which must not count as a collapse.
    const record = {
      sawClosing: false,
      closingFrames: 0,
      before: { width: shell.offsetWidth, height: shell.offsetHeight },
      min: { width: shell.offsetWidth, height: shell.offsetHeight },
      closingAnimation: "",
      openAnimation: getComputedStyle(shell).animationName,
    };
    window.__modalExit = record;
    const sampleClosing = () => {
      if (backdrop.dataset.overlayState === "closing") {
        record.sawClosing = true;
        record.closingAnimation = getComputedStyle(shell).animationName;
        record.min = {
          width: Math.min(record.min.width, shell.offsetWidth),
          height: Math.min(record.min.height, shell.offsetHeight),
        };
      }
    };
    // A short crossfade may finish before a busy browser renders another frame.
    // Observe the actual closing commit as well; frame counts remain RAF-only.
    const observer = new MutationObserver(() => {
      if (!backdrop.isConnected) { observer.disconnect(); return; }
      sampleClosing();
    });
    observer.observe(backdrop, { attributes: true, attributeFilter: ['data-overlay-state'] });
    if (backdrop.parentElement) observer.observe(backdrop.parentElement, { childList: true });
    const sample = () => {
      if (!backdrop.isConnected) { observer.disconnect(); return; }
      if (backdrop.dataset.overlayState === 'closing') record.closingFrames += 1;
      sampleClosing();
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

test.describe("normal motion", () => {

  test("closing a dialog plays its exit lifecycle without collapsing the shell", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await importTestWallet(page);
    const dialog = await openSend(page);
    await observeExit(dialog);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    const exit = await page.evaluate(() => window.__modalExit);
    expect(exit?.sawClosing, "the closing state must be observable").toBe(true);
    expect(exit?.closingFrames ?? 0).toBeGreaterThanOrEqual(1);
    expect(exit?.min.height ?? 0, "the shell keeps its height through the exit").toBeGreaterThanOrEqual((exit?.before.height ?? 0) - 1);
    expect(exit?.min.width ?? 0, "the shell keeps its width through the exit").toBeGreaterThanOrEqual((exit?.before.width ?? 0) - 1);
    expect(exit?.closingAnimation).toMatch(/^(dialogOut|sheetOut)$/);
  });

  test("dialogs present as a bottom sheet on compact widths and a card above them", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await importTestWallet(page);
    const dialog = await openSend(page);
    const width = page.viewportSize()?.width ?? 1024;
    const presentation = await dialog.getAttribute("data-presentation");
    const geometry = await dialog.evaluate((node) => {
      const shell = (node as HTMLElement).querySelector<HTMLElement>("[data-modal-shell]");
      if (!shell) throw new Error("dialog shell missing");
      const rect = shell.getBoundingClientRect();
      const style = getComputedStyle(shell);
      return {
        bottomGap: window.innerHeight - rect.bottom,
        topRadius: parseFloat(style.borderTopLeftRadius),
        bottomRadius: parseFloat(style.borderBottomLeftRadius),
        grabber: shell.querySelector(".modal-grabber") !== null,
        animation: style.animationName,
        widthRatio: rect.width / window.innerWidth,
      };
    });
    if (width < 640) {
      expect(presentation).toBe("sheet");
      expect(Math.abs(geometry.bottomGap)).toBeLessThanOrEqual(1);
      expect(geometry.topRadius).toBeGreaterThan(0);
      expect(geometry.bottomRadius).toBe(0);
      expect(geometry.grabber).toBe(true);
      expect(geometry.animation).toBe("sheetIn");
      expect(geometry.widthRatio).toBeGreaterThan(0.99);
    } else {
      expect(presentation).toBe("card");
      expect(geometry.grabber).toBe(false);
      expect(geometry.animation).toBe("dialogIn");
      expect(geometry.bottomRadius).toBeGreaterThan(0);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("a dialog receives focus itself, not its close control", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await importTestWallet(page);
    const dialog = await openSend(page);
    await expect.poll(() => dialog.evaluate((node) => {
      const active = document.activeElement;
      return active?.hasAttribute("data-modal-shell") && node.contains(active);
    })).toBe(true);
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("a press that travels across the backdrop does not dismiss", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await importTestWallet(page);
    const dialog = await openSend(page);
    const box = await dialog.boundingBox();
    if (!box) throw new Error("dialog bounds missing");
    // Press near the top-left corner of the dim and release 40px away.
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 52, box.y + 52, { steps: 4 });
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("reduced motion", () => {

  test("the exit observer retains a close completed before its next frame", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await importTestWallet(page);
    const dialog = await openSend(page);
    await page.evaluate(() => {
      const request = window.requestAnimationFrame;
      const cancel = window.cancelAnimationFrame;
      const pending = new Map<number, FrameRequestCallback>();
      let next = -1;
      window.requestAnimationFrame = callback => { const id = next--; pending.set(id, callback); return id; };
      window.cancelAnimationFrame = id => { if (!pending.delete(id)) cancel.call(window, id); };
      window.__resumeModalFrames = () => {
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
        for (const callback of pending.values()) callback(performance.now());
        pending.clear();
      };
    });
    try {
      await observeExit(dialog);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toBeHidden();
      const exit = await page.evaluate(() => window.__modalExit);
      expect(exit?.closingFrames).toBe(0);
      expect(exit?.sawClosing).toBe(true);
      expect(exit?.closingAnimation).toBe('fadeOut');
      expect(exit?.min).toEqual(exit?.before);
    } finally {
      await page.evaluate(() => { window.__resumeModalFrames?.(); delete window.__resumeModalFrames; });
    }
  });

  test("Reduce Motion crossfades instead of removing the exit", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await importTestWallet(page);
    const dialog = await openSend(page);
    await observeExit(dialog);
    const started = Date.now();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    const elapsed = Date.now() - started;
    const exit = await page.evaluate(() => window.__modalExit);
    expect(exit?.openAnimation).toBe("fadeIn");
    expect(exit?.sawClosing).toBe(true);
    expect(exit?.closingAnimation).toBe("fadeOut");
    expect(elapsed).toBeLessThan(1500);
  });
});
