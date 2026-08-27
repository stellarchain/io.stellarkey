import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the install action lives in the right Settings column instead of the sidebar", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const settings = read("src/components/SettingsPage.tsx");
  const sidebar = dashboard.slice(
    dashboard.indexOf("Navigation & Accounts Scroll Body"),
    dashboard.indexOf("Main Content Area"),
  );

  assert.doesNotMatch(sidebar, /Install App|installEvt\.prompt/);
  assert.match(
    dashboard,
    /<SettingsPage[\s\S]*?installAvailable=\{installHandoff\.available\}[\s\S]*?onInstallApp=\{handleInstallApp\}/,
  );
  assert.match(dashboard, /function handleInstallApp\(\)[\s\S]*?installEvt\.prompt\(\)/);
  assert.match(
    settings,
    /Column 2: Accounts & Tools[\s\S]*?installAvailable && \([\s\S]*?App[\s\S]*?label="Install App"[\s\S]*?onClick=\{onInstallApp\}/,
  );
});
