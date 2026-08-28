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
  assert.match(about, /how a wallet action works/i);
  assert.match(about, /constructs an unsigned transaction/i);
  assert.match(about, /merchant mode/i);
  assert.match(about, /AGPL-3\.0-or-later/i);
  assert.match(about, /APPLICATION_VERSION/);
  assert.match(about, /BUILD_COMMIT/);
  assert.match(about, /GitHub/i);
  assert.match(about, /not affiliated with, sponsored or endorsed/i);
  assert.match(privacy, /no analytics/i);
  assert.match(privacy, /localStorage|IndexedDB/);
  assert.match(privacy, /Horizon|RPC/);
  assert.match(privacy, /IP address/i);
  assert.match(privacy, /no non-essential cookies/i);
  assert.match(privacy, /data controller|data processor/i);
  assert.match(privacy, /retention and deletion/i);
  assert.match(privacy, /public blockchain/i);
  assert.match(privacy, /does not make blockchain data private/i);
  assert.match(terms, /self-custodial/i);
  assert.match(terms, /irreversible/i);
  assert.match(terms, /recovery phrase/i);
  assert.match(terms, /asset issuer/i);
  assert.match(terms, /merchant records/i);
  assert.match(terms, /AGPL-3\.0-or-later/i);
  assert.match(terms, /free software/i);
  assert.match(terms, /no professional advice/i);
  assert.match(terms, /disclaimer of warranties/i);
  assert.match(terms, /limitation of liability/i);
  assert.match(terms, /non-excludable rights|cannot lawfully be excluded/i);
  assert.match(security, /responsible disclosure/i);
  assert.match(security, /APPLICATION_VERSION/);
  assert.match(security, /supported release/i);
  assert.match(read("src/components/LegalPage.tsx"), /Legal text version 1\.1/);
  assert.match(security, /threat model/i);
  assert.match(security, /AES-GCM/i);
  assert.match(security, /PBKDF2/i);
  assert.match(security, /600,000/i);
  assert.match(security, /ongoing security maintenance/i);
  assert.match(security, /NIST|OWASP/i);
  assert.match(security, /cannot guarantee absolute\s+security/i);
  assert.match(security, /\.well-known\/security\.txt/i);
  assert.match(security, /never include/i);
  assert.match(security, /recovery phrase|secret key/i);
  assert.match(security, /ContactAction/);
  assert.match(support, /ContactAction/);
  assert.match(support, /cannot recover|cannot reverse/i);
  assert.match(support, /safe to include/i);
  assert.match(support, /GitHub issue/i);
  assert.match(support, /no guaranteed response time/i);
});

test("long-form trust pages expose plain-language summaries and on-page navigation", () => {
  const legalPage = read("src/components/LegalPage.tsx");
  assert.match(legalPage, /highlights:/);
  assert.match(legalPage, /sections:/);
  assert.match(legalPage, /aria-label="At a glance"/);
  assert.match(legalPage, /aria-label="On this page"/);

  for (const route of routes) {
    const source = read(`src/app/${route}/page.tsx`);
    assert.match(source, /highlights=\{/i, `${route} is missing its plain-language highlights`);
    assert.match(source, /sections=\{/i, `${route} is missing its on-page navigation`);
    assert.match(source, /<section id="[^"]+">/i, `${route} sections are not directly linkable`);
  }
});

test("trust-center chrome uses one accessible icon language without replacing text labels", () => {
  const legalPage = read("src/components/LegalPage.tsx");
  for (const icon of [
    "IconCompass",
    "IconEyeOff",
    "IconFileText",
    "IconFingerprint",
    "IconBook",
    "IconCheck",
    "IconList",
  ]) {
    assert.match(legalPage, new RegExp(icon), `${icon} is missing from the trust-center presentation`);
  }
  assert.match(legalPage, /className="legal-hero"/);
  assert.match(legalPage, /className="legal-route-icon"/);
  assert.match(legalPage, /className="legal-highlight-icon"/);
  assert.match(legalPage, /aria-hidden="true"/);
  assert.match(legalPage, />\{label\}</, "navigation icons must retain visible text labels");
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
  assert.match(footer, /PUBLIC_ROUTES\.support/);
  assert.match(footer, /SOURCE_REPOSITORY_URL/);
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
  for (const destination of [
    /PUBLIC_ROUTES\.about/,
    /PUBLIC_ROUTES\.privacy/,
    /PUBLIC_ROUTES\.terms/,
    /PUBLIC_ROUTES\.security/,
    /PUBLIC_ROUTES\.support/,
    /SOURCE_REPOSITORY_URL/,
    /SOURCE_COMMIT_URL/,
    /SOURCE_RELEASE_URL/,
    /href:\s*"\/release\.json"/,
  ]) {
    assert.match(settings, destination);
  }
});

test("the expanded wallet sidebar shows copyright and exact build identity after Lock Wallet", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  assert.match(dashboard, /COPYRIGHT_YEAR/);
  assert.match(dashboard, /COPYRIGHT_OWNER/);
  assert.match(dashboard, /APPLICATION_VERSION/);
  assert.match(dashboard, /BUILD_COMMIT/);
  assert.match(dashboard, /aria-label="Build information"/);
  assert.match(
    dashboard,
    /<p className="whitespace-nowrap">[\s\S]*© \{COPYRIGHT_YEAR\} \{COPYRIGHT_OWNER\}[\s\S]*v\{APPLICATION_VERSION\} · \{BUILD_COMMIT/,
  );

  const lockWallet = dashboard.indexOf("<span>Lock Wallet</span>");
  const buildInformation = dashboard.indexOf('aria-label="Build information"');
  assert.notEqual(lockWallet, -1);
  assert.ok(buildInformation > lockWallet, "build information must follow the sidebar Lock Wallet action");
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
