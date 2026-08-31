import { expect, test } from "@playwright/test";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
  testPassword,
} from "./fixtures";

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

test("only the Web Locks owner writes merchant data and another tab takes over", async ({
  context,
  page,
}) => {
  await importTestWallet(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: "Merchant Mode" }).click();
  const setup = page.getByRole("dialog", { name: /Set up Merchant Mode/ });
  await setup.getByLabel("Shop name").fill("Two Tab Coffee");
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByText("Trustline held", { exact: true }).waitFor();
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByText("Step 3 of 4", { exact: false }).waitFor();
  await setup.getByRole("button", { name: "Continue" }).click();
  await setup.getByRole("textbox", { name: "Staff PIN", exact: true }).fill("2468");
  await setup.getByRole("textbox", { name: "Confirm staff PIN", exact: true }).fill("2468");
  await setup.getByRole("button", { name: "Open the till" }).click();
  await setup.waitFor({ state: "hidden" });

  const second = await context.newPage();
  await second.goto("/app", { waitUntil: "domcontentloaded" });
  await second.getByPlaceholder("Enter password").fill(testPassword);
  await second.getByRole("button", { name: "Unlock Vault" }).click();
  await second.getByRole("button", { name: "Settings", exact: true }).click();
  await second.getByRole("button", { name: "Turn off Merchant Mode", exact: true }).click();
  const turnOff = second.getByRole("dialog", { name: "Turn off Merchant Mode?" });
  const confirmTurnOff = turnOff.getByRole("button", { name: "Turn Off Merchant Mode" });
  await confirmTurnOff.click();
  await expect(
    second.getByText(
      "Merchant editing is active in another tab. Close it or wait for this tab to take over, then try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(turnOff).toBeVisible();

  await page.close();
  await expect.poll(() => second.evaluate(async () => {
    const state = await navigator.locks.query();
    return state.held?.some((lock) => lock.name === "stellarkey.merchant.writer.v1") ?? false;
  })).toBe(true);

  await confirmTurnOff.click();
  // Turning Merchant Mode off unloads its lazy runtime and returns Settings to
  // the wallet overview, so the switch intentionally leaves the DOM.
  await expect.poll(() => second.evaluate(() => {
    const raw = localStorage.getItem("stellarkey.merchant-bootstrap.v1");
    return raw ? (JSON.parse(raw) as { enabled?: unknown }).enabled : null;
  })).toBe(false);
  await expect(second.getByText("Your Assets", { exact: true })).toBeVisible();
});
