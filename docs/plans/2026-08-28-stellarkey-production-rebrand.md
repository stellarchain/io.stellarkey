# StellarKey Production Rebrand Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a coherent, backend-free StellarKey production identity at `https://stellarkey.io` with accurate legal/security disclosures, complete discovery metadata, resilient static-host security, and verified iPhone/desktop presentation.

**Architecture:** Keep one immutable brand contract in `src/lib/brand.ts`, consume it from server metadata and client integrations, and preserve every legacy storage/crypto identifier. Add public Server Component routes for legal content, a tiny client-only encoded contact action, static Next metadata routes, and build tooling that verifies CSP/offline behavior across every exported HTML route.

**Tech Stack:** Next.js 16 App Router static export, React 19, TypeScript, Tailwind CSS 4, Node test runner, Playwright Chromium/WebKit, RFC 9116 security.txt.

---

### Task 1: Canonical StellarKey identity

**Files:**
- Create: `src/lib/brand.ts`
- Create: `tests/production-brand.test.mjs`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/manifest.webmanifest`
- Modify: `src/lib/hardware.ts`
- Modify: `src/lib/passkey-prf.ts`
- Modify: `src/components/Onboarding.tsx`
- Modify: `src/components/LockScreen.tsx`
- Modify: `src/app/error.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/SettingsPage.tsx`
- Modify: `src/components/PaperWalletModal.tsx`
- Modify: `src/components/BackupWizardModal.tsx`
- Modify: `src/components/StorageRecoveryScreen.tsx`
- Modify: `src/components/AddressBookPage.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`

**Steps:**
1. Write a failing source-contract test requiring `StellarKey`, `https://stellarkey.io`, copyright year 2026, title/description/application metadata, PWA naming, Trezor name and production fallback origin, passkey relying-party name, branded public UI, branded export filenames, and unchanged `polaris.*`/`wallet.*` compatibility identifiers.
2. Run `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/production-brand.test.mjs` and confirm failure because the brand module and identity do not exist.
3. Add a dependency-free brand module with `BRAND_NAME`, `BRAND_ORIGIN`, `BRAND_DESCRIPTION`, `COPYRIGHT_OWNER`, `COPYRIGHT_YEAR`, route constants, and numeric contact-codepoint records. Do not store complete contact addresses as strings.
4. Update metadata, manifest, hardware/passkey identity, product-specific UI labels, package name, README, and user download filenames. Keep generic wallet nouns where they describe the wallet function and retain every storage key, backup envelope kind, crypto salt, cache prefix, and legacy parser identifier.
5. Re-run the focused test and existing icon, hardware, passkey, backup, and install tests until green.
6. Run typecheck and `git diff --check`.
7. Commit: `feat: establish StellarKey product identity`.

### Task 2: Public About, Privacy, Terms, and Security experience

**Files:**
- Create: `src/components/PublicFooter.tsx`
- Create: `src/components/LegalPage.tsx`
- Create: `src/components/ContactAction.tsx`
- Create: `src/app/about/page.tsx`
- Create: `src/app/privacy/page.tsx`
- Create: `src/app/terms/page.tsx`
- Create: `src/app/security/page.tsx`
- Create: `src/app/not-found.tsx`
- Create: `tests/legal-surfaces.test.mjs`
- Modify: `src/app/page.tsx`
- Modify: `src/components/Onboarding.tsx`
- Modify: `src/components/LockScreen.tsx`
- Modify: `src/components/SettingsPage.tsx`
- Modify: `src/app/error.tsx`
- Modify: `src/app/globals.css`

**Steps:**
1. Write a failing test requiring four directly linkable routes, route metadata, plain-language product disclosures, self-custody/irreversibility/third-party/local-storage terms, the SDF independence/trademark notice, Settings navigation, public footers, a branded 404, a skip target, and the absence of complete contact addresses from source policy files.
2. Run the focused legal test and confirm the missing-route failure.
3. Implement a semantic `LegalPage` shell with a compact brand header, iOS-style grouped navigation, readable 65-character prose, section anchors, active-page state, safe-area spacing, and a small copyright/trademark footer. Reuse the existing typography, surfaces, icon mark, focus rings, and motion-reduction behavior.
4. Implement a client-only `ContactAction` that reconstructs the selected address from numeric code points at click time and exposes a descriptive accessible button without rendering a raw address.
5. Add accurate About, Privacy, Terms, and Security content. State that the app has no accounts, analytics, advertising, telemetry, non-essential cookies, or application backend; list direct third-party network disclosures; explain self-custody and irreversible transactions; document responsible disclosure and report exclusions; and avoid claims of universal legal compliance.
6. Add the public footer to onboarding, lock, error, and home shell; add an `About & Legal` Settings subpage; and add a branded static 404 with working navigation.
7. Run the focused tests, typecheck, lint on changed files, and `git diff --check`.
8. Commit: `feat: add StellarKey legal and trust center`.

### Task 3: Discovery, sharing, RFC 9116, CSP, and offline hardening

**Files:**
- Create: `src/app/robots.ts`
- Create: `src/app/sitemap.ts`
- Create: `src/app/opengraph-image.tsx`
- Create: `public/.well-known/security.txt`
- Create: `tests/production-discovery.test.mjs`
- Modify: `src/app/layout.tsx`
- Modify: `scripts/generate-static-headers.mjs`
- Modify: `scripts/generate-service-worker.mjs`
- Modify: `scripts/static-server.mjs`
- Modify: `public/_headers`
- Modify: `public/sw.js`
- Modify: `tests/security-policy.test.mjs`
- Modify: `tests/service-worker-upgrade.test.mjs`

**Steps:**
1. Write failing tests for canonical robots/sitemap output, RFC 9116 Contact/Canonical/Policy/Expires fields, no raw mailbox, structured `SoftwareApplication` data, social image metadata, text/plain serving, production cache directives, legal-route precaching, static-route path resolution, and CSP authorization of inline scripts from every exported HTML file.
2. Run focused discovery/security/service-worker tests and confirm the missing production surfaces and multi-page build-tool failures.
3. Add static-safe Next metadata routes and a build-time Open Graph image with an explicit 1200×630 size and accessible description.
4. Add JSON-LD to the root layout using a safely escaped serialized object and keep it shared so every route has consistent application identity.
5. Add a valid `/.well-known/security.txt` that points to the HTTPS Security page and expires on 2027-08-28.
6. Refactor the CSP hash generator to recursively collect every exported HTML document and authorize the union of their inline scripts. Export pure helpers for direct tests.
7. Extend the service-worker generator to include the four disclosure routes and resolve `/route`, `/route.html`, and `/route/index.html` representations without caching wallet/API data.
8. Teach the static server to serve `.txt` as `text/plain; charset=utf-8` and apply exact/prefix header rules. Add immutable Next asset caching, no-cache HTML/manifest/discovery/service-worker behavior, HSTS for production HTTPS, and retain existing security headers.
9. Build, inspect `out/`, and run focused tests, typecheck, lint, and `git diff --check`.
10. Commit: `feat: harden StellarKey production discovery`.

### Task 4: Domain deployment and origin-migration runbook

**Files:**
- Create: `docs/production-deployment.md`
- Create: `tests/production-docs.test.mjs`
- Modify: `docs/release-checklist.md`
- Modify: `README.md`

**Steps:**
1. Write a failing documentation test requiring canonical apex deployment, `www` redirect, TLS/security header verification, DNS/email authentication, support/security alias validation, passkey and browser-storage origin boundaries, backup-first migration, Trezor production-origin verification, clean PWA install, offline legal routes, and a small-value mainnet smoke test.
2. Confirm the focused docs test fails because the production runbook does not exist.
3. Document the provider-neutral static deployment sequence. Note that `stellarkey.io` currently has no public DNS response, but do not invent provider records. Include MX/SPF/DKIM/DMARC setup for the two mailboxes, optional DNSSEC/CAA, apex canonicalization, HTTPS, headers/caching, rollback, and post-deploy verification.
4. Explain that passkeys, service-worker caches, localStorage, and IndexedDB are origin-bound and require password plus encrypted-backup recovery rather than automatic migration.
5. Run focused documentation/release tests and `git diff --check`.
6. Commit: `docs: add StellarKey production runbook`.

### Task 5: Responsive public-route browser gate

**Files:**
- Create: `e2e/public-release.spec.ts`
- Modify: `playwright.config.ts` only if the existing project matching excludes the new test
- Modify: `src/app/globals.css` and public components only for observed issues

**Steps:**
1. Add browser tests that visit home, About, Privacy, Terms, Security, and a missing path; assert titles, canonical links, footer navigation, structured data, security contact action, no console/page errors, no horizontal overflow at 320px, reachable back navigation, minimum touch targets, and basic Axe coverage.
2. Run the focused desktop Chromium and iPhone WebKit test and observe the expected failure before any necessary polish.
3. Apply only evidence-driven layout/accessibility fixes using existing design tokens and components.
4. Re-run focused browser tests and capture screenshots for manual visual inspection at desktop and narrow iPhone widths.
5. Run affected unit tests, typecheck, lint, and `git diff --check`.
6. Commit: `test: gate StellarKey public release surfaces`.

### Task 6: Complete release, review, integration, and LAN refresh

**Files:**
- Modify only files required by review findings.

**Steps:**
1. Run `npm run release:verify` and require typecheck, all unit tests, lint, high-severity production audit, static build, bundle budgets, desktop Chromium, iPhone WebKit, and iPad WebKit to pass.
2. Inspect every `out/*.html`, `out/manifest.webmanifest`, `out/robots.txt`, `out/sitemap.xml`, `out/.well-known/security.txt`, `out/_headers`, and `out/sw.js` for canonical identity, complete metadata, CSP compatibility, raw mailbox leakage, and offline boundaries.
3. Request a code review focused on legal-copy accuracy against actual behavior, static-export compatibility, contact obfuscation, CSP completeness, cache safety, storage-key compatibility, and mobile accessibility. Address valid findings with tests first and commit separately.
4. Use the finishing-a-development-branch workflow. With the user’s standing instruction to merge approved features to `main`, fast-forward after verification, preserve unrelated untracked files, rebuild the main checkout, and verify the merged SHA.
5. Restart only the exact static process behind the existing HTTPS LAN proxy and smoke-test `https://192.168.0.180:3000` in a fresh 320px WebKit context.
