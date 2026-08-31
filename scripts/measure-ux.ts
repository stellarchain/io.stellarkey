import {
  chromium,
  devices,
  expect,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  importTestWallet,
  installNetworkFixtures,
  installQuietEventSource,
} from "../e2e/fixtures.ts";

type MetricName =
  | "domContentLoaded"
  | "activityNavigation"
  | "sendModalVisible"
  | "privateTabSelected"
  | "privatePanelUsable"
  | "cls"
  | "longTaskMax";

type Sample = Record<MetricName, number>;

type Profile = {
  name: "desktop" | "throttled-mobile" | "reduced-motion";
  runs: number;
  context: BrowserContextOptions;
  cpuRate?: number;
  network?: {
    latency: number;
    downloadThroughput: number;
    uploadThroughput: number;
  };
};

const baseURL = process.env.UX_BASE_URL ?? "https://localhost:3443";
const requestedRuns = Number(process.env.UX_RUNS ?? "0");
const profiles: Profile[] = [
  {
    name: "desktop",
    runs: requestedRuns || 4,
    context: { viewport: { width: 1440, height: 900 } },
  },
  {
    name: "throttled-mobile",
    runs: requestedRuns || 4,
    context: { ...devices["iPhone 13"] },
    cpuRate: 4,
    network: {
      latency: 150,
      downloadThroughput: 1_600_000 / 8,
      uploadThroughput: 750_000 / 8,
    },
  },
  {
    name: "reduced-motion",
    runs: requestedRuns || 2,
    context: { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" },
  },
];

async function markNextActivation(target: Locator, name: string): Promise<void> {
  await target.evaluate((element, markName) => {
    element.addEventListener("click", () => {
      const lab = (window as typeof window & {
        __stellarkeyUxLab?: { marks: Record<string, number> };
      }).__stellarkeyUxLab;
      if (lab) lab.marks[markName] = performance.now();
    }, { capture: true, once: true });
  }, name);
}

async function elapsedFromMark(page: Page, name: string): Promise<number> {
  return page.evaluate((markName) => {
    const started = (window as typeof window & {
      __stellarkeyUxLab?: { marks: Record<string, number> };
    }).__stellarkeyUxLab?.marks[markName];
    if (started === undefined) throw new Error("UX activation mark is unavailable.");
    return performance.now() - started;
  }, name);
}

async function measure(profile: Profile): Promise<Sample> {
  const context = await browser.newContext({
    ...profile.context,
    baseURL,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
  });
  await installQuietEventSource(context);
  await installNetworkFixtures(context);
  await context.addInitScript(() => {
    const lab = { cls: 0, longTaskMax: 0, marks: {} as Record<string, number> };
    (window as typeof window & { __stellarkeyUxLab?: typeof lab }).__stellarkeyUxLab = lab;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput) lab.cls += shift.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          lab.longTaskMax = Math.max(lab.longTaskMax, entry.duration);
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Unsupported observers remain a zero-valued lab proxy.
    }
  });
  const page = await context.newPage();
  await importTestWallet(page);
  const domContentLoaded = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return navigation ? navigation.domContentLoadedEventEnd - navigation.startTime : 0;
  });
  await page.evaluate(() => {
    const lab = (window as typeof window & {
      __stellarkeyUxLab?: { cls: number; longTaskMax: number; marks: Record<string, number> };
    }).__stellarkeyUxLab;
    if (!lab) return;
    lab.cls = 0;
    lab.longTaskMax = 0;
    lab.marks = {};
  });
  if (profile.cpuRate || profile.network) {
    const cdp = await context.newCDPSession(page);
    if (profile.cpuRate) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
    }
    if (profile.network) {
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        ...profile.network,
        connectionType: "cellular4g",
      });
    }
  }

  const activityTrigger = page.getByRole("button", { name: "Activity", exact: true }).first();
  await markNextActivation(activityTrigger, "activity-navigation");
  await activityTrigger.click();
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  const activityNavigation = await elapsedFromMark(page, "activity-navigation");
  await page.getByRole("button", { name: "Home", exact: true }).first().click();
  await expect(page.getByText("Your Assets", { exact: true })).toBeVisible();

  const sendTrigger = page.getByRole("main").getByRole("button", { name: "Send", exact: true }).first();
  await markNextActivation(sendTrigger, "send-modal");
  await sendTrigger.click();
  await expect(page.getByRole("dialog", { name: "Send Payment", exact: true })).toBeVisible();
  const sendModalVisible = await elapsedFromMark(page, "send-modal");
  const dialog = page.getByRole("dialog", { name: "Send Payment", exact: true });
  const privateTab = dialog.getByRole("tablist", { name: "Send type" })
    .getByRole("tab", { name: "Private", exact: true });
  await markNextActivation(privateTab, "private-tab");
  await privateTab.click();
  await expect(privateTab).toHaveAttribute("aria-selected", "true");
  const privateTabSelected = await elapsedFromMark(page, "private-tab");
  await expect(dialog.getByText(/Set up private|Review Private Send|Recipient Address/i).first()).toBeVisible();
  const privatePanelUsable = await elapsedFromMark(page, "private-tab");
  const lab = await page.evaluate(() => (
    (window as typeof window & {
      __stellarkeyUxLab?: { cls: number; longTaskMax: number; marks: Record<string, number> };
    }).__stellarkeyUxLab ?? { cls: 0, longTaskMax: 0, marks: {} }
  ));
  await context.close();

  return {
    domContentLoaded,
    activityNavigation,
    sendModalVisible,
    privateTabSelected,
    privatePanelUsable,
    cls: lab.cls,
    longTaskMax: lab.longTaskMax,
  };
}

function summarize(samples: Sample[]) {
  return (Object.keys(samples[0]) as MetricName[]).reduce<Record<MetricName, {
    median: number;
    slowest: number;
  }>>((summary, metric) => {
    const values = samples.map((sample) => sample[metric]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 === 0
      ? (values[middle - 1] + values[middle]) / 2
      : values[middle];
    summary[metric] = {
      median: Number(median.toFixed(metric === "cls" ? 4 : 1)),
      slowest: Number(values.at(-1)!.toFixed(metric === "cls" ? 4 : 1)),
    };
    return summary;
  }, {} as Record<MetricName, { median: number; slowest: number }>);
}

const browser = await chromium.launch();
try {
  const output: Record<string, unknown> = {
    source: "synthetic-local",
    baseURL,
    browser: "Chromium",
    profiles: {},
  };
  for (const profile of profiles) {
    const samples: Sample[] = [];
    for (let run = 0; run < profile.runs; run += 1) {
      samples.push(await measure(profile));
    }
    (output.profiles as Record<string, unknown>)[profile.name] = {
      runs: profile.runs,
      cpuRate: profile.cpuRate ?? 1,
      network: profile.network ?? "local",
      throttleAppliedAfterWalletReady: Boolean(profile.cpuRate || profile.network),
      summary: summarize(samples),
    };
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  await browser.close();
}
