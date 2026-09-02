import { expect, test } from "@playwright/test";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
  testSecret,
} from "./fixtures";

test.use({ serviceWorkers: "block" });

test("fails closed when the pinned Private Payments catalogue bytes are modified", async ({
  context,
  page,
}) => {
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
  let tamperedRequests = 0;
  await context.route("**/protocol/private-balance/v1/catalogue.json", async (route) => {
    tamperedRequests += 1;
    const response = await route.fetch();
    const catalogue = JSON.parse(await response.text());
    catalogue.deployments = [
      {
        id: "injected-testnet-xlm",
        network: "testnet",
        asset: {
          kind: "native",
          code: "XLM",
          issuer: null,
          name: "Stellar Lumens",
          decimals: 7,
          displayDecimals: 7,
          contractId: "CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF",
        },
        manifestUrl: "/protocol/private-balance/v1/manifest.json",
        manifestSha256: "0".repeat(64),
      },
    ];
    await route.fulfill({ response, body: JSON.stringify(catalogue) });
  });
  const manifestRequested = page
    .waitForRequest("**/protocol/private-balance/v1/manifest.json", { timeout: 2_000 })
    .then(() => true, () => false);
  const observed: string[] = [];
  page.on("console", (message) => observed.push(message.text()));
  page.on("pageerror", (error) => observed.push(error.message));

  await importTestWallet(page);
  await expect.poll(() => tamperedRequests).toBeGreaterThan(0);

  expect(await manifestRequested).toBe(false);
  await expect(page.getByRole("region", { name: "Your Private Assets", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Open private XLM\./ })).toHaveCount(0);
  await expect(page.getByText("Private Payments is on")).toHaveCount(0);
  expect(observed.join("\n")).not.toContain(testSecret);
});
