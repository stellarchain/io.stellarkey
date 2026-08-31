import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
} from "./fixtures";

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
    const state = { removed: 0, backdropAnimations: 0, scrollUnlocks: 0 };
    (window as typeof window & { __continuity?: typeof state }).__continuity = state;
    backdrop.addEventListener("animationstart", () => {
      state.backdropAnimations += 1;
    });
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node === backdrop || node === shell || (node instanceof Element && node.contains(shell))) {
            state.removed += 1;
          }
        }
      }
      if (document.body.style.overflow !== "hidden") state.scrollUnlocks += 1;
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  }, shellId);
}

async function expectStableContinuity(page: Page, shellId: string) {
  await expect.poll(() => page.evaluate((id) => {
    const shell = document.querySelector<HTMLElement>("[data-modal-shell]");
    const backdrop = document.querySelector<HTMLElement>("[data-modal-backdrop]");
    const state = (window as typeof window & {
      __continuity?: { removed: number; backdropAnimations: number; scrollUnlocks: number };
    }).__continuity;
    return {
      shell: shell?.dataset.continuityId === id,
      backdrop: backdrop?.dataset.continuityId === id,
      removed: state?.removed ?? -1,
      backdropAnimations: state?.backdropAnimations ?? -1,
      scrollUnlocks: state?.scrollUnlocks ?? -1,
      locked: document.body.style.overflow === "hidden",
      focusInside: Boolean(backdrop?.contains(document.activeElement)),
    };
  }, shellId)).toEqual({
    shell: true,
    backdrop: true,
    removed: 0,
    backdropAnimations: 0,
    scrollUnlocks: 0,
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

  let releasePrivateChunk!: () => void;
  const privateChunkGate = new Promise<void>((resolve) => {
    releasePrivateChunk = resolve;
  });
  let heldChunk = false;
  await page.route("**/_next/static/chunks/**", async (route: Route) => {
    if (!heldChunk && route.request().resourceType() === "script") {
      heldChunk = true;
      await privateChunkGate;
    }
    await route.continue();
  });

  await privateTab.click();
  await expect(privateTab).toHaveAttribute("aria-selected", "true");
  await expect(privateTab).toBeFocused();
  await expect(dialog.getByRole("status", { name: "Opening private payment" })).toBeVisible();
  await expectStableContinuity(page, shellId);

  releasePrivateChunk();
  await expect(dialog.getByText(/Set up private|Review Private Send|Recipient Address/i).first()).toBeVisible();

  for (let index = 0; index < 3; index += 1) {
    await publicTab.click();
    await expect(publicTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByLabel("Asset")).toBeVisible();
    await expect(dialog.getByText(/Set up private|Review Private Send/i)).toHaveCount(0);
    await privateTab.click();
    await expect(privateTab).toHaveAttribute("aria-selected", "true");
  }
  await expectStableContinuity(page, shellId);

  await publicTab.click();
  await expect(dialog.getByText(/Set up private|Review Private Send/i)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByText(/Set up private|Review Private Send/i)).toHaveCount(0);
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
  await expect(dialog.getByText(/Set up private/i).first()).toBeVisible();
  await expectStableContinuity(page, shellId);

  for (let index = 0; index < 3; index += 1) {
    await publicTab.click();
    await expect(publicTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByAltText("Address QR code")).toBeVisible();
    await expect(dialog.getByText(/Set up private/i)).toHaveCount(0);
    await privateTab.click();
    await expect(privateTab).toHaveAttribute("aria-selected", "true");
  }
  await expectStableContinuity(page, shellId);

  await publicTab.click();
  await expect(dialog.getByText(/Set up private/i)).toHaveCount(0);
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
  await expect(dialog.getByText(/Set up private/i).first()).toBeVisible();
  await expectStableContinuity(page, shellId);

  for (let index = 0; index < 3; index += 1) {
    await publicTab.click();
    await expect(publicTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByPlaceholder(/Search popular tokens/)).toBeVisible();
    await expect(dialog.getByText(/Set up private/i)).toHaveCount(0);
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
    await page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Send Payment", exact: true });
    const tablist = dialog.getByRole("tablist", { name: "Send type" });
    const publicTab = tablist.getByRole("tab", { name: "Public", exact: true });
    const privateTab = await requirePrivateTab(dialog, "Send type");
    await publicTab.focus();
    await publicTab.press("ArrowRight");
    await expect(privateTab).toBeFocused();
    await expect(privateTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  });
});
