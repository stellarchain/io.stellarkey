import { expect, test, type Route } from "@playwright/test";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
  testPayer,
} from "./fixtures";

test.beforeEach(async ({ context }) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
});

test("pending Send retains its action identity and prevents duplicate submission", async ({ page }) => {
  await importTestWallet(page);
  await page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first().click();
  const send = page.getByRole("dialog", { name: "Send Payment", exact: true });
  await send.getByPlaceholder("0.00").fill("1");
  await send.getByPlaceholder(/user\*domain\.com/).fill(testPayer);
  await send.getByRole("button", { name: "Review Transfer" }).click();

  const confirm = send.getByRole("button", { name: "Confirm Send", exact: true });
  await expect(confirm).toBeVisible();
  const settledBox = await confirm.boundingBox();
  expect(settledBox).not.toBeNull();

  let releaseSubmission!: () => void;
  const submissionGate = new Promise<void>((resolve) => {
    releaseSubmission = resolve;
  });
  let submissionRequests = 0;
  await page.route("https://horizon-testnet.stellar.org/transactions", async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    submissionRequests += 1;
    await submissionGate;
    await route.fallback();
  });

  await confirm.click();
  await expect(confirm).toHaveAttribute("aria-busy", "true");
  await expect(confirm).toHaveAttribute("data-loading", "true");
  await expect(confirm).toBeDisabled();
  await expect(send.getByRole("status", { name: "Sending payment" })).toBeAttached();
  await expect.poll(() => submissionRequests).toBe(1);
  const pendingBox = await confirm.boundingBox();
  expect(pendingBox).not.toBeNull();
  expect(Math.abs((pendingBox?.width ?? 0) - (settledBox?.width ?? 0))).toBeLessThan(1);

  await confirm.evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => submissionRequests).toBe(1);

  releaseSubmission();
  await expect(send.getByText(/Payment Confirmed|Payment Accepted/).first()).toBeVisible();
});
