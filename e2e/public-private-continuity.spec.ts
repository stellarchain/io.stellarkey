import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
} from "./fixtures";

// Service Worker-owned requests bypass page.route; transport-delay tests must
// own chunk delivery. Offline/PWA behavior is covered separately in pwa.spec.
test.use({ reducedMotion: "no-preference", serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

async function requirePrivateTab(dialog: Locator, tablistName: string) {
  const privateTab = dialog.getByRole("tablist", { name: tablistName })
    .getByRole("tab", { name: "Private", exact: true });
  if (process.env.E2E_PRIVATE_UI_REQUIRED === "1") {
    await expect(privateTab).toBeVisible({ timeout: 30_000 });
    return privateTab;
  }
  test.skip(await privateTab.count() === 0, "Private Payments has no release-approved deployment.");
  return privateTab;
}

async function installContinuityObserver(page: Page, shellId: string) {
  await page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>("[data-modal-shell]");
    const backdrop = document.querySelector<HTMLElement>("[data-modal-backdrop]");
    if (!shell || !backdrop) throw new Error("Modal shell is unavailable.");
    await Promise.all(
      [...backdrop.getAnimations(), ...shell.getAnimations()].map((animation) =>
        animation.finished.catch(() => undefined),
      ),
    );
  });
  await page.evaluate((id) => {
    const shell = document.querySelector<HTMLElement>("[data-modal-shell]");
    const backdrop = document.querySelector<HTMLElement>("[data-modal-backdrop]");
    if (!shell || !backdrop) throw new Error("Modal shell is unavailable.");
    shell.dataset.continuityId = id;
    backdrop.dataset.continuityId = id;
    const scrollOwner = document.querySelector<HTMLElement>("[data-app-scroll-owner]");
    const app = document.querySelector<HTMLElement>("[data-app-surface]");
    const state = { removed: 0, backdropAnimations: 0, scrollUnlocks: 0, inertInterruptions: 0, unintendedCloses: 0 };
    (window as typeof window & { __continuity?: typeof state }).__continuity = state;
    backdrop.addEventListener("animationstart", (event) => {
      if (event.target === backdrop || event.target === shell) state.backdropAnimations += 1;
    });
    new MutationObserver((records) => {
      for (const record of records) {
        // Old attribute values also expose unlock/relock within one task,
        // which checking only the final DOM state would miss.
        if (record.type === "attributes" && record.attributeName === "style" &&
            (record.target === document.body || record.target === scrollOwner) &&
            !/overflow:\s*hidden/.test(record.oldValue ?? "")) state.scrollUnlocks += 1;
        if (record.target === app && record.attributeName === "inert" && record.oldValue === null) state.inertInterruptions += 1;
        if (record.target === backdrop && record.attributeName === "data-overlay-state" &&
            (record.oldValue !== "open" || backdrop.dataset.overlayState !== "open")) state.unintendedCloses += 1;
        for (const node of record.removedNodes) {
          if (node === backdrop || node === shell || (node instanceof Element && node.contains(shell))) {
            state.removed += 1;
          }
        }
      }
      if (document.body.style.overflow !== "hidden") state.scrollUnlocks += 1;
      if (scrollOwner && scrollOwner.style.overflow !== "hidden") state.scrollUnlocks += 1;
      if (app && !app.inert) state.inertInterruptions += 1;
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["style", "inert", "data-overlay-state"] });
  }, shellId);
}

async function expectStableContinuity(page: Page, shellId: string) {
  await expect.poll(() => page.evaluate((id) => {
    const shell = document.querySelector<HTMLElement>("[data-modal-shell]");
    const backdrop = document.querySelector<HTMLElement>("[data-modal-backdrop]");
    const state = (window as typeof window & {
      __continuity?: { removed: number; backdropAnimations: number; scrollUnlocks: number; inertInterruptions: number; unintendedCloses: number };
    }).__continuity;
    return {
      shell: shell?.dataset.continuityId === id,
      backdrop: backdrop?.dataset.continuityId === id,
      removed: state?.removed ?? -1,
      backdropAnimations: state?.backdropAnimations ?? -1,
      scrollUnlocks: state?.scrollUnlocks ?? -1,
      inertInterruptions: state?.inertInterruptions ?? -1,
      unintendedCloses: state?.unintendedCloses ?? -1,
      locked: document.body.style.overflow === "hidden",
      focusInside: Boolean(backdrop?.contains(document.activeElement)),
    };
  }, shellId)).toEqual({
    shell: true,
    backdrop: true,
    removed: 0,
    backdropAnimations: 0,
    scrollUnlocks: 0,
    inertInterruptions: 0,
    unintendedCloses: 0,
    locked: true,
    focusInside: true,
  });
}

async function expectDialogInsideViewport(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("[data-modal-shell]");
    if (!shell) return { shellInside: false, noPageOverflow: false };
    const bounds = shell.getBoundingClientRect();
    return {
      shellInside: bounds.left >= -1 && bounds.right <= window.innerWidth + 1,
      noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  })).toEqual({ shellInside: true, noPageOverflow: true });
}

test("Public and Private remain one continuous Send dialog", async ({ page }) => {
  let releasePrivateChunk!: () => void;
  const privateChunkGate = new Promise<void>(resolve => { releasePrivateChunk = resolve; });
  let heldChunk = false;
  let heldChunkUrl = "";
  // Install before navigation: the first arriving chunk is not reliably the
  // access-gate chunk. Match its fixed public UI copy in static code, never
  // wallet data, and hold delivery of that exact lazy dependency.
  await page.route("**/_next/static/chunks/**", async (route: Route) => {
    if (route.request().resourceType() !== "script") return route.continue();
    const response = await route.fetch();
    const body = await response.body();
    if (!heldChunk && body.includes(Buffer.from("Turn On Private Payments"))) {
      heldChunk = true;
      heldChunkUrl = route.request().url();
      await privateChunkGate;
    }
    await route.fulfill({ response, body });
  });
  try {
    await importTestWallet(page);
    const trigger = page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Send Payment", exact: true });
    const shellId = "send-public-private-shell";
    await expect(dialog).toBeVisible();
    await expectDialogInsideViewport(page);
    await installContinuityObserver(page, shellId);

    const tablist = dialog.getByRole("tablist", { name: "Send type" });
    const publicTab = tablist.getByRole("tab", { name: "Public", exact: true });
    const privateTab = await requirePrivateTab(dialog, "Send type");
    await expect(publicTab).toHaveAttribute("aria-selected", "true");

    await privateTab.click();
    await expect(privateTab).toHaveAttribute("aria-selected", "true");
    await expect(privateTab).toBeFocused();
    await expect(dialog.getByRole("status", { name: "Opening private payment" })).toBeVisible();
    await expect.poll(() => heldChunk && heldChunkUrl.length > 0).toBe(true);
    await expectStableContinuity(page, shellId);

    // Leave and re-enter while the first chunk is genuinely held, not after its
    // panel has already settled. An obsolete completion must not select Private.
    for (let index = 0; index < 3; index += 1) {
      await publicTab.click();
      await expect(publicTab).toHaveAttribute("aria-selected", "true");
      await expect(dialog.getByLabel("Asset")).toBeVisible();
      await privateTab.click();
      await expect(privateTab).toHaveAttribute("aria-selected", "true");
      await expect(dialog.getByRole("status", { name: "Opening private payment" })).toBeVisible();
      await expectStableContinuity(page, shellId);
    }
    await publicTab.click();
    const deliveredChunk = page.waitForResponse(response => response.url() === heldChunkUrl);
    releasePrivateChunk();
    await (await deliveredChunk).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(publicTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByLabel("Asset")).toBeVisible();
    await expect(dialog.getByText(/Turn on Private Payments|Review Private Send/i)).toHaveCount(0);
    await expectStableContinuity(page, shellId);
    await privateTab.click();
    await expect(dialog.getByText(/Turn on Private Payments|Review Private Send|Recipient Address/i).first()).toBeVisible();

    for (let index = 0; index < 3; index += 1) {
      await publicTab.click();
      await expect(publicTab).toHaveAttribute("aria-selected", "true");
      await expect(dialog.getByLabel("Asset")).toBeVisible();
      await expect(dialog.getByText(/Turn on Private Payments|Review Private Send/i)).toHaveCount(0);
      await privateTab.click();
      await expect(privateTab).toHaveAttribute("aria-selected", "true");
    }
    await expectStableContinuity(page, shellId);

    await publicTab.click();
    await expect(dialog.getByText(/Turn on Private Payments|Review Private Send/i)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByText(/Turn on Private Payments|Review Private Send/i)).toHaveCount(0);
  } finally {
    releasePrivateChunk();
  }
});

test("Public and Private remain one continuous Receive dialog", async ({ page }) => {
  await importTestWallet(page);
  const trigger = page.getByRole("main").getByRole("button", { name: "Receive", exact: true }).first();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Receive Funds", exact: true });
  const shellId = "receive-public-private-shell";
  await expect(dialog).toBeVisible();
  await expectDialogInsideViewport(page);
  await installContinuityObserver(page, shellId);

  const tablist = dialog.getByRole("tablist", { name: "Receive address type" });
  const publicTab = tablist.getByRole("tab", { name: "Public", exact: true });
  const privateTab = await requirePrivateTab(dialog, "Receive address type");
  await expect(publicTab).toHaveAttribute("aria-selected", "true");

  await privateTab.click();
  await expect(privateTab).toHaveAttribute("aria-selected", "true");
  await expect(privateTab).toBeFocused();
  await expect(dialog.getByText(/Turn on Private Payments/i).first()).toBeVisible();
  await expectStableContinuity(page, shellId);

  for (let index = 0; index < 3; index += 1) {
    await publicTab.click();
    await expect(publicTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByAltText("Address QR code")).toBeVisible();
    await expect(dialog.getByText(/Turn on Private Payments/i)).toHaveCount(0);
    await privateTab.click();
    await expect(privateTab).toHaveAttribute("aria-selected", "true");
  }
  await expectStableContinuity(page, shellId);

  await publicTab.click();
  await expect(dialog.getByText(/Turn on Private Payments/i)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Public and Private remain one continuous Add dialog", async ({ page }) => {
  await importTestWallet(page);
  const trigger = page.getByRole("main").getByRole("button", { name: "Add", exact: true }).first();

  let releasePublicChunk!: () => void;
  const publicChunkGate = new Promise<void>((resolve) => {
    releasePublicChunk = resolve;
  });
  let heldChunk = false;
  await page.route("**/_next/static/chunks/**", async (route: Route) => {
    if (!heldChunk && route.request().resourceType() === "script") {
      heldChunk = true;
      await publicChunkGate;
    }
    await route.continue();
  });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Add Assets", exact: true });
  const shellId = "add-public-private-shell";
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status", { name: "Opening public assets" })).toBeVisible();
  await expectDialogInsideViewport(page);
  await installContinuityObserver(page, shellId);

  releasePublicChunk();

  const tablist = dialog.getByRole("tablist", { name: "Where to add funds" });
  const publicTab = tablist.getByRole("tab", { name: "Public", exact: true });
  const privateTab = await requirePrivateTab(dialog, "Where to add funds");
  await expect(publicTab).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByLabel("Search verified assets", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Custom asset code", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Custom asset issuer address", { exact: true })).toBeVisible();

  await privateTab.click();
  await expect(privateTab).toHaveAttribute("aria-selected", "true");
  await expect(privateTab).toBeFocused();
  await expect(dialog.getByText(/Turn on Private Payments/i).first()).toBeVisible();
  await expectStableContinuity(page, shellId);

  for (let index = 0; index < 3; index += 1) {
    await publicTab.click();
    await expect(publicTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByPlaceholder(/Search popular tokens/)).toBeVisible();
    await expect(dialog.getByText(/Turn on Private Payments/i)).toHaveCount(0);
    await privateTab.click();
    await expect(privateTab).toHaveAttribute("aria-selected", "true");
  }
  await expectStableContinuity(page, shellId);

  await publicTab.click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("critical public payment fields keep programmatic labels", async ({ page }) => {
  await importTestWallet(page);

  await page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first().click();
  const send = page.getByRole("dialog", { name: "Send Payment", exact: true });
  await expect(send.getByLabel("Amount", { exact: true })).toBeVisible();
  await expect(send.getByLabel("Recipient Address or Federation", { exact: true })).toBeVisible();
  await expect(send.getByLabel("Memo (Optional)", { exact: true })).toBeVisible();
  await send.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("main").getByRole("button", { name: "Receive", exact: true }).first().click();
  const receive = page.getByRole("dialog", { name: "Receive Funds", exact: true });
  await receive.getByRole("button", { name: "Set Amount / Memo", exact: true }).click();
  await expect(receive.getByLabel("Amount (optional)", { exact: true })).toBeVisible();
  await expect(receive.getByLabel("Memo (optional)", { exact: true })).toBeVisible();
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("keyboard tab activation keeps the same Send dialog", async ({ page }) => {
    await importTestWallet(page);
    const trigger = page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Send Payment", exact: true });
    await installContinuityObserver(page, "keyboard-send");
    const tablist = dialog.getByRole("tablist", { name: "Send type" });
    const publicTab = tablist.getByRole("tab", { name: "Public", exact: true });
    const privateTab = await requirePrivateTab(dialog, "Send type");
    await publicTab.focus();
    await publicTab.press("ArrowRight");
    await expect(privateTab).toBeFocused();
    await expect(privateTab).toHaveAttribute("aria-selected", "false");
    await expect(publicTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByText(/Turn on Private Payments/i)).toHaveCount(0);
    await privateTab.press("Enter");
    await expect(privateTab).toHaveAttribute("aria-selected", "true");
    for (let index = 0; index < 3; index += 1) {
      await privateTab.press("Home");
      await expect(publicTab).toBeFocused();
      await expect(privateTab).toHaveAttribute("aria-selected", "true");
      await publicTab.press("Space");
      await expect(publicTab).toHaveAttribute("aria-selected", "true");
      await expect(dialog.getByText(/Turn on Private Payments/i)).toHaveCount(0);
      await publicTab.press("End");
      await privateTab.press("Enter");
    }
    await expectStableContinuity(page, "keyboard-send");
    await privateTab.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByText(/Turn on Private Payments/i)).toHaveCount(0);
  });
});
