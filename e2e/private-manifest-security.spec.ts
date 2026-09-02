import { expect, test } from "@playwright/test";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
  testSecret,
} from "./fixtures";

test.use({ serviceWorkers: "block" });

test("fails closed when the pinned Private Payments manifest bytes are modified", async ({
  context,
  page,
}) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
  let tamperedRequests = 0;
  await context.route("**/protocol/private-balance/v1/*/manifest.json", async (route) => {
    tamperedRequests += 1;
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()} ` });
  });
  const observed: string[] = [];
  page.on("console", (message) => observed.push(message.text()));
  page.on("pageerror", (error) => observed.push(error.message));

  await importTestWallet(page);
  await expect.poll(() => tamperedRequests).toBeGreaterThan(0);

  const region = page.getByRole("region", { name: "Your Private Assets", exact: true });
  await expect(region).toBeVisible({ timeout: 30_000 });
  await expect(region).toContainText("Private Balance manifest hash mismatch.", {
    timeout: 30_000,
  });
  await expect(region.getByRole("button", { name: /^Open private XLM\./ })).toHaveCount(0);
  await expect(page.getByText("Private Payments is on")).toHaveCount(0);
  expect(observed.join("\n")).not.toContain(testSecret);
});
