import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installNetworkFixtures, installQuietEventSource } from "./fixtures";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
  await context.addInitScript(() => {
    // Exercise the real banner with controlled lifecycle events, never a wallet.
    const container = new EventTarget();
    const registration = new EventTarget();
    const worker = new EventTarget();
    let state = "installed";
    let waiting: EventTarget | null = worker;
    let controller: EventTarget = new EventTarget();
    let mode = "activate";
    let attempts = 0;
    Object.defineProperties(worker, {
      state: { get: () => state },
      postMessage: { value: (message: { type: string }, ports?: MessagePort[]) => {
        if (message.type === "GET_RELEASE") {
          ports?.[0]?.postMessage(null);
          return;
        }
        if (message.type !== "SKIP_WAITING") return;
        attempts++;
        if (mode === "fail") throw new DOMException("Synthetic stopped worker", "InvalidStateError");
        if (mode === "stall") return;
        sessionStorage.setItem("synthetic-update-applied", "yes");
        state = "activated";
        waiting = null;
        controller = worker;
        container.dispatchEvent(new Event("controllerchange"));
      } },
    });
    if (sessionStorage.getItem("synthetic-update-applied")) waiting = null;
    Object.defineProperties(registration, {
      waiting: { get: () => waiting },
      installing: { value: null },
    });
    Object.defineProperties(container, {
      controller: { get: () => controller },
      register: { value: async () => registration },
    });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
    Object.defineProperty(window, "syntheticUpdate", { value: {
      setMode(value: string) { mode = value; },
      attempts: () => attempts,
      retire() {
        waiting = null;
        state = "redundant";
        worker.dispatchEvent(new Event("statechange"));
      },
      activateElsewhere() {
        waiting = null;
        state = "activated";
        controller = worker;
        container.dispatchEvent(new Event("controllerchange"));
      },
    } });
  });
});

declare global {
  interface Window {
    syntheticUpdate: {
      setMode(mode: string): void;
      attempts(): number;
      retire(): void;
      activateElsewhere(): void;
    };
  }
}

const banner = (page: import("@playwright/test").Page) => page.getByRole("status").filter({ hasText: "Update ready" });

test("update action reloads once and does not return after another refresh", async ({ page }) => {
  await page.goto("/app");
  await expect(banner(page)).toBeVisible();
  await page.evaluate(() => localStorage.setItem("synthetic-update-sentinel", "keep"));
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page.getByRole("button", { name: "Update and reload" }).click(),
  ]);
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("synthetic-update-sentinel"))).toBe("keep");
  await page.reload();
  await expect(banner(page)).toHaveCount(0);
});

test("a removed worker clears the banner without navigating", async ({ page }) => {
  await page.goto("/app");
  await expect(banner(page)).toBeVisible();
  let navigations = 0;
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
  await page.evaluate(() => window.syntheticUpdate.retire());
  await expect(banner(page)).toHaveCount(0);
  expect(navigations).toBe(0);
});

test("failed activation shows a retry and preserves the current page", async ({ page }) => {
  await page.goto("/app");
  await expect(banner(page)).toBeVisible();
  await page.evaluate(() => window.syntheticUpdate.setMode("fail"));
  const button = page.getByRole("button", { name: "Update and reload" });
  await button.click();
  await expect(banner(page)).toContainText("try again");
  await expect(button).toBeEnabled();
  const accessibility = await new AxeBuilder({ page }).include('[role="status"]').analyze();
  expect(accessibility.violations.map(({ id }) => id)).toEqual([]);
  expect(await page.evaluate(() => window.syntheticUpdate.attempts())).toBe(1);
  await page.evaluate(() => window.syntheticUpdate.setMode("activate"));
  await button.focus();
  await Promise.all([page.waitForEvent("domcontentloaded"), page.keyboard.press("Enter")]);
  await expect(banner(page)).toHaveCount(0);
});

test("stalled activation times out and never reloads later without renewed consent", async ({ page }) => {
  await page.clock.install();
  await page.goto("/app");
  await expect(banner(page)).toBeVisible();
  await page.evaluate(() => window.syntheticUpdate.setMode("stall"));
  await page.getByRole("button", { name: "Update and reload" }).click();
  await expect(page.getByRole("button", { name: "Updating…" })).toBeDisabled();
  await page.clock.fastForward(15_001);
  await expect(banner(page)).toContainText("try again");
  await expect(page.getByRole("button", { name: "Update and reload" })).toBeEnabled();
  await page.evaluate(() => window.syntheticUpdate.activateElsewhere());
  expect(await page.evaluate(() => window.syntheticUpdate.attempts())).toBe(1);
  await expect(banner(page)).toBeVisible();
});
