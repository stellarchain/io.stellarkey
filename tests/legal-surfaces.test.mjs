import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const routes = ["about", "privacy", "terms", "security", "support"];

test("StellarKey exposes complete directly linkable trust-center routes", () => {
  for (const route of routes) {
    const page = `src/app/${route}/page.tsx`;
    assert.equal(existsSync(new URL(`../${page}`, import.meta.url)), true, `${route} route is missing`);
    const source = read(page);
    assert.match(source, /export const metadata:\s*Metadata/);
    assert.match(source, new RegExp(`canonical:\\s*PUBLIC_ROUTES\\.${route}`));
    assert.match(source, /<LegalPage/);
  }

  const about = read("src/app/about/page.tsx");
  const privacy = read("src/app/privacy/page.tsx");
  const terms = read("src/app/terms/page.tsx");
  const security = read("src/app/security/page.tsx");
  const support = read("src/app/support/page.tsx");

  assert.match(about, /backend-free/i);
  assert.match(about, /APPLICATION_VERSION/);
  assert.match(about, /BUILD_COMMIT/);
  assert.match(about, /GitHub/i);
  assert.match(about, /not affiliated with, sponsored or endorsed/i);
  assert.match(privacy, /no analytics/i);
  assert.match(privacy, /localStorage|IndexedDB/);
  assert.match(privacy, /Horizon|RPC/);
  assert.match(privacy, /IP address/i);
  assert.match(privacy, /no non-essential cookies/i);
  assert.match(terms, /self-custodial/i);
  assert.match(terms, /irreversible/i);
  assert.match(terms, /recovery phrase/i);
  assert.match(terms, /asset issuer/i);
  assert.match(terms, /merchant records/i);
  assert.match(security, /responsible disclosure/i);
  assert.match(security, /APPLICATION_VERSION/);
  assert.match(security, /supported release/i);
  assert.match(read("src/components/LegalPage.tsx"), /Legal text version 1\.0/);
  assert.match(security, /never include/i);
  assert.match(security, /recovery phrase|secret key/i);
  assert.match(security, /ContactAction/);
  assert.match(support, /ContactAction/);
  assert.match(support, /cannot recover|cannot reverse/i);
});

test("public and locked surfaces share accessible legal navigation", () => {
  const footer = read("src/components/PublicFooter.tsx");
  const legalPage = read("src/components/LegalPage.tsx");
  const contact = read("src/components/ContactAction.tsx");
  const settings = read("src/components/SettingsPage.tsx");

  assert.match(footer, /©.*COPYRIGHT_YEAR.*COPYRIGHT_OWNER/s);
  assert.match(footer, /PUBLIC_ROUTES\.about/);
  assert.match(footer, /PUBLIC_ROUTES\.privacy/);
  assert.match(footer, /PUBLIC_ROUTES\.terms/);
  assert.match(footer, /PUBLIC_ROUTES\.security/);
  assert.match(footer, /Stellar.*trademark of the Stellar Development Foundation/i);
  assert.match(footer, /independent project/i);
  assert.match(legalPage, /<main[^>]*id="app-content"/);
  assert.match(legalPage, /aria-label="Legal navigation"/);
  assert.match(legalPage, /aria-current=/);
  assert.match(contact, /decodeContactAddress\(channel\)/);
  assert.match(contact, /mailto:/);
  assert.match(contact, /type="button"/);

  for (const component of ["Onboarding", "LockScreen"]) {
    const source = read(`src/components/${component}.tsx`);
    assert.match(source, /PublicFooter/);
  }
  assert.match(read("src/app/error.tsx"), /PublicFooter/);
  assert.match(read("src/app/error.tsx"), /<main[^>]*id="app-content"/);
  assert.match(read("src/app/layout.tsx"), /href="#app-content"/);
  assert.match(read("src/app/page.tsx"), /id="app-content"/);
  assert.match(settings, /\| "about"/);
  assert.match(settings, /label="About & Legal"/);
  assert.match(settings, /sub === "about"/);
});

test("the custom 404 is branded and never strands the user", () => {
  const source = read("src/app/not-found.tsx");
  assert.match(source, /export const metadata:\s*Metadata/);
  assert.match(source, /title:\s*"Page not found"/);
  assert.match(source, /index:\s*false/);
  assert.match(source, /Page not found/);
  assert.match(source, /BRAND_NAME/);
  assert.match(source, /href=\{PUBLIC_ROUTES\.home\}/);
  assert.match(source, /PublicFooter/);
});
