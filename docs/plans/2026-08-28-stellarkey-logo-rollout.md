# StellarKey Logo Rollout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Use the supplied lock-and-Stellar mark consistently across the application, install surfaces, exported paper wallets, and production metadata while preserving the canonical StellarKey product name.

**Architecture:** Keep the supplied transparent `currentColor` SVG as the public master artwork and render the same geometry inline through `LogoMark` so it inherits the surrounding interface color. Platform icons use a full-bleed StellarKey blue background with a white, safe-area-scaled copy of the master mark; Next.js continues to discover `icon.svg`, `apple-icon.png`, and the static web manifest through its App Router metadata conventions.

**Tech Stack:** Next.js 16 App Router metadata files, React 19 SVG components, static raster assets, Node test runner.

---

### Task 1: Lock the supplied artwork into regression coverage

**Files:**
- Modify: `tests/app-icon.test.mjs`

1. Add assertions that `public/stellarkey-logo.svg` contains the supplied view box, lock shackle, circular body, and official Stellar glyph.
2. Add PNG decoding assertions proving every install icon is full-bleed blue at all four corners and uses white artwork at its centre.
3. Assert the printable paper-wallet certificate contains the same shackle and Stellar glyph.
4. Run `npm test -- tests/app-icon.test.mjs` and confirm failure because the canonical public SVG and full-bleed raster icons do not yet exist.

### Task 2: Install the logo across application surfaces

**Files:**
- Create: `public/stellarkey-logo.svg`
- Modify: `src/components/icons.tsx`
- Modify: `src/app/icon.svg`
- Modify: `src/lib/paperwallet.ts`
- Modify: `public/icon-192.png`
- Modify: `public/icon-512.png`
- Modify: `public/icon-maskable-512.png`
- Modify: `public/apple-touch-icon.png`
- Modify: `src/app/apple-icon.png`

1. Add the supplied SVG unchanged as `public/stellarkey-logo.svg`.
2. Keep `LogoMark` geometry identical to the master and color it through `currentColor`.
3. Use the same geometry in the Next favicon source and printable certificate.
4. Render full-bleed blue PNG assets with white safe-area artwork at 192, 512, and 180 pixels; keep them guarded by pixel-level regression tests rather than adding an ad-hoc browser script to the release toolchain.
5. Run the focused icon test and confirm it passes.

### Task 3: Verify naming and production output

**Files:**
- Verify: `src/lib/brand.ts`
- Verify: `src/app/layout.tsx`
- Verify: `src/app/manifest.webmanifest`
- Verify: `src/lib/hardware.ts`
- Verify: `src/lib/passkey-prf.ts`
- Verify: `src/components/Onboarding.tsx`
- Verify: `src/components/LockScreen.tsx`

1. Confirm all visible application identity is sourced from or exactly matches `StellarKey`.
2. Preserve `stellarkey.*` storage and cryptographic compatibility identifiers.
3. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
4. Inspect the generated icon images and key application screens.
5. Stage only the logo, branding test, generated icons, and this plan; commit as one branding feature.
