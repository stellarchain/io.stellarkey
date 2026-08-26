# Merchant SOTA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert every screen in the new merchant design from fixture-driven previews into a complete, persisted, local-first Stellar point of sale with truthful integrations and SOTA mobile, accessibility, reliability, and test quality.

**Architecture:** Upgrade the merchant store through a validated v1-to-v2 migration, keep business rules in pure TypeScript modules, expose mutation/query actions through `useMerchant`, and make components render only persisted or externally verified state. Horizon reconciles crypto payments; wallet actions remain explicitly reviewed and signed; unavailable device/server capabilities are represented honestly.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5.9, `@stellar/stellar-sdk` 17, Web Crypto, Horizon REST, Node test runner, Playwright, ESLint.

---

### Task 1: Upgrade and validate merchant persistence

**Files:**
- Modify: `src/lib/merchant/types.ts`
- Modify: `src/lib/merchant/defaults.ts`
- Modify: `src/lib/merchant/storage.ts`
- Create: `tests/merchant-storage.test.mjs`

1. Write failing tests for a complete v2 round-trip, v1 migration, partial/corrupt nested data reconciliation, future-version rejection, both-key clearing, and preservation of existing core records.
2. Run `node --test tests/merchant-storage.test.mjs` and confirm failures describe the missing v2 behavior.
3. Add v2 staff, shifts, invoices, counter codes/payments, customers, settlement rules, adjustments, refund requests, peripherals, export records, preferences, counters, and terminal state to `MerchantStore`.
4. Read v2 first, migrate validated v1 data, reconcile nested records, persist v2 atomically, and retain bounded historical pruning without deleting open financial records.
5. Run the focused test, full unit suite, typecheck, and commit `feat(merchant): add versioned operational store`.

### Task 2: Make merchant setup atomic and secure

**Files:**
- Create: `src/lib/merchant/pin.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/SetupWizard.tsx`
- Modify: `src/components/SettingsPage.tsx`
- Create: `tests/merchant-pin.test.mjs`
- Create or modify: `tests/merchant-setup.test.mjs`

1. Write failing tests for salted PIN creation/verification, wrong PIN, malformed credentials, atomic setup validation, and cancelled setup remaining disabled.
2. Implement versioned PBKDF2 credentials through injected Web Crypto primitives and constant-time byte comparison.
3. Add one `completeSetup` action that validates profile, receiving account, accepted assets, taxes, tips, terminal, owner role, and PIN before one persistence commit.
4. Wire the wizard to real trustline actions and save; show signing/retry state and never claim success before completion.
5. Make settings open setup before enabling an unconfigured merchant and preserve an existing configuration when editing.
6. Verify, typecheck, build, and commit `feat(merchant): persist secure merchant setup`.

### Task 3: Implement staff sessions, permissions, and refund approval

**Files:**
- Create: `src/lib/merchant/permissions.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/StaffTerminalsPage.tsx`
- Modify: `src/components/merchant/RefundSheet.tsx`
- Modify: `src/components/merchant/RefundRequestsSheet.tsx`
- Create: `tests/merchant-permissions.test.mjs`

1. Test role ceilings, custom permissions, PIN session switching, lockout/rate limit, staff lifecycle constraints, and pending/approved/rejected refund requests.
2. Implement pure authorization checks and persisted staff/refund-request actions with audit timestamps and actor IDs.
3. Replace mock roster, PIN reset, permissions, and refund queues with real actions. Require owner authorization to alter roles or reset credentials.
4. Route over-ceiling refunds into approval; approved requests call the existing signed refund path and record the actual result.
5. Verify and commit `feat(merchant): add staff permissions and refund approvals`.

### Task 4: Persist cash, card, split tenders, stock, and adjustments

**Files:**
- Modify: `src/lib/merchant/types.ts`
- Create: `src/lib/merchant/orders.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/PosTerminal.tsx`
- Modify: `src/components/merchant/CashTenderSheet.tsx`
- Modify: `src/components/merchant/AdjustmentSheet.tsx`
- Modify: `src/components/merchant/ReceiptSheet.tsx`
- Create: `tests/merchant-orders.test.mjs`

1. Test exact totals, cash change, card reference, split remainder, crypto completion, insufficient/excess tenders, idempotent stock decrement, adjustment audit, and reload persistence.
2. Extend `TenderKind` with external card and retain every tender leg plus reference.
3. Add pure order-settlement and stock helpers, then expose `settleCash`, `settleCard`, `startSplitCharge`, `applyAdjustment`, `voidLine`, and `compLine` actions.
4. Replace preview order numbers and local post-sale state with persisted records. Generate receipts from the settled order and real staff/customer/device data.
5. Verify and commit `feat(merchant): persist complete till tender flows`.

### Task 5: Harden crypto matching and duplicate handling

**Files:**
- Modify: `src/lib/merchant/match.ts`
- Modify: `src/lib/merchant/watch.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/DuplicateChargeSheet.tsx`
- Modify: `src/components/merchant/UnmatchedPaymentsSheet.tsx`
- Create or modify: `tests/merchant-match.test.mjs`
- Create: `tests/merchant-watch.test.mjs`

1. Test exact asset identity, memo match, under/over/late payments, duplicate payment IDs, duplicate paid memos, split remainder, watcher cursor recovery, and idempotent replay.
2. Persist a typed reconciliation outcome for every observed payment and route true duplicates to the duplicate sheet rather than the generic unmatched tray.
3. Require an explicit attach, refund, or dismiss audit action for ambiguous payments; never mutate a paid order twice.
4. Use exact decimal conversion for refundable and settled values and decrement stock only at first complete settlement.
5. Verify and commit `fix(merchant): make crypto reconciliation exact and idempotent`.

### Task 6: Implement shifts and real X/Z reports

**Files:**
- Create: `src/lib/merchant/shifts.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/ShiftSheet.tsx`
- Modify: `src/components/merchant/PosTerminal.tsx`
- Create: `tests/merchant-shifts.test.mjs`

1. Test opening float, one active shift per terminal, derived tender totals, refunds/adjustments, X snapshot, blind close, cash variance, unresolved-flow guard, and immutable Z report.
2. Implement shift actions and derive reports from persisted records in the shift interval.
3. Replace mock staff/terminal/counts/adjustments and wire the POS shift indicator and lock behavior.
4. Verify and commit `feat(merchant): add audited shift lifecycle`.

### Task 7: Implement invoices with exact payment quotes

**Files:**
- Create: `src/lib/merchant/invoices.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/InvoicesPage.tsx`
- Modify: `src/components/merchant/InvoiceComposerModal.tsx`
- Modify: `src/components/merchant/InvoiceDetailModal.tsx`
- Modify: `src/lib/payuri.ts`
- Create: `tests/merchant-invoices.test.mjs`

1. Test numbering, draft validation, issue-time immutable quotes, correct SEP-7 URI asset/amount/memo, partial/full Horizon settlement, manual settlement audit, void constraints, duplicate, reload, and print/export view.
2. Implement invoice CRUD and reconciliation with canonical minor/asset values.
3. Replace all mock lists/status overrides and make every detail action persist before success feedback.
4. Provide honest empty/error states when pricing or Horizon is unavailable.
5. Verify and commit `feat(merchant): implement payable invoice lifecycle`.

### Task 8: Implement persistent counter payment codes

**Files:**
- Create: `src/lib/merchant/counter-codes.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/PaymentLinksPage.tsx`
- Modify: `src/components/merchant/LinkEditorModal.tsx`
- Modify: `src/components/merchant/CounterPosterModal.tsx`
- Create: `tests/merchant-counter-codes.test.mjs`

1. Test CRUD, pause/resume, stable slug/reference, fixed quote-at-print, open/tip incoming pricing, expiry, deduplication, and poster URI accuracy.
2. Persist codes and immutable quote facts. Reconcile observed payments to code references and surface unpriceable payments for review.
3. Replace preview rates, mock addresses, local-only toggles, and generated-toasts with domain actions and real account/network data.
4. Verify and commit `feat(merchant): add reconciled counter payment codes`.

### Task 9: Implement customers, contacts, notes, and loyalty

**Files:**
- Create: `src/lib/merchant/customers.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/CustomersPage.tsx`
- Modify: `src/components/merchant/CustomerDetailModal.tsx`
- Modify: `src/components/merchant/ReceiptSheet.tsx`
- Create: `tests/merchant-customers.test.mjs`

1. Test payer upsert, wallet-contact matching, spend/visit derivation, note persistence, loyalty earn/redeem audit, invoice/order history, and privacy-preserving forget.
2. Create/update customers after settled crypto orders and invoices; never infer identity beyond address/contact data the user owns.
3. Replace mock records and local detail state with persisted actions and real history.
4. Verify and commit `feat(merchant): add persistent customer and loyalty records`.

### Task 10: Generate real tax records, insights, and exports

**Files:**
- Create: `src/lib/merchant/reporting.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/TaxRecordsPage.tsx`
- Modify: `src/components/merchant/InsightsPage.tsx`
- Create: `tests/merchant-reporting.test.mjs`

1. Test period derivation, inclusive/exclusive tax, refunds, discounts, tender/asset grouping, empty periods, stable CSV/JSON escaping, and export audit records.
2. Derive all reports from persisted orders/refunds/adjustments and remove fixture fallbacks.
3. Implement actual file downloads for supported formats; label unsupported third-party schemas unavailable instead of simulating exports.
4. Show bounded skeletons followed by real data, empty, or retryable errors.
5. Verify and commit `feat(merchant): add truthful reporting and exports`.

### Task 11: Implement settlement-rule handoffs

**Files:**
- Create: `src/lib/merchant/settlement.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/MerchantSettings.tsx`
- Modify: `src/components/merchant/MerchantPage.tsx`
- Modify: `src/components/SwapPage.tsx`
- Modify: `src/components/SendModal.tsx`
- Create: `tests/merchant-settlement.test.mjs`

1. Test rule CRUD, thresholds, retained balances, due calculations, disabled/insufficient rules, and exact swap/send handoff intents.
2. Persist rules and derive due actions without background signing.
3. Replace local mock rules and route an accepted action into existing reviewed Swap/Send flows with immutable source context.
4. Verify and commit `feat(merchant): add explicit settlement handoffs`.

### Task 12: Make peripherals, offline, and customer-display states truthful

**Files:**
- Modify: `src/components/merchant/PeripheralsPage.tsx`
- Modify: `src/components/merchant/OfflineStates.tsx`
- Modify: `src/components/merchant/CustomerDisplay.tsx`
- Modify: `src/components/merchant/MerchantSettings.tsx`
- Modify: `src/hooks/useMerchant.tsx`
- Create: `tests/merchant-runtime.test.mjs`

1. Test online/offline transitions, watcher errors/retry, vault locked/unlocked, queued/expired charges, same-device display lock, browser print, scanner input, and unsupported bridge messaging.
2. Drive runtime banners from `navigator.onLine`, wallet phase, Horizon watcher state, and persisted pending work.
3. Persist supported device preferences. Keep browser print/AirPrint and keyboard scanners functional; report bridge-dependent Bluetooth/ESC-POS/drawer/external-display actions as unavailable.
4. Remove gallery/specimen behavior from production navigation.
5. Verify and commit `feat(merchant): expose truthful operational states`.

### Task 13: Remove production mocks and polish every merchant screen

**Files:**
- Modify: all production files under `src/components/merchant/`
- Modify: `src/hooks/useMerchant.tsx`
- Remove runtime use of: `src/lib/merchant/mock.ts`
- Modify: `src/app/globals.css`
- Create: `tests/merchant-no-mocks.test.mjs`
- Create: `e2e/merchant.spec.ts`

1. Add a guard test that production merchant components do not import mock fixtures or contain known simulated-success copy.
2. Audit every button, menu, sheet, modal, empty state, loading state, error state, and reload path; wire, disable with reason, or remove each one.
3. Apply iPhone safe-area spacing once, 44px targets, 16px inputs, visual-viewport sheets, hidden scrollbars with retained scrolling, accessible labels, focus restoration, and reduced motion.
4. Add deterministic browser journeys for setup, reload, cash sale, crypto watcher settlement, split sale, refund approval, shift close, invoice, counter code, customer, export, offline recovery, and install mode.
5. Verify and commit `feat(merchant): complete production merchant experience`.

### Task 14: Final requirement-by-requirement verification

**Files:**
- Review: `docs/plans/2026-08-26-merchant-sota-design.md`
- Review: every changed merchant and shared wallet file

1. Build an evidence table for each design contract and every task above; treat missing, indirect, or fixture-only evidence as incomplete.
2. Run `npm test`, `npm run typecheck`, source-scoped `npm run lint`, `npm run build`, production dependency audit, and all deterministic Playwright merchant journeys.
3. Inspect the production bundle and live app for runtime mock imports, stale skeletons, console errors, unhandled promises, mobile overflow/zoom, duplicate safe areas, inaccessible dialogs, and misleading success copy.
4. Test against intercepted Horizon outcomes plus one read-only live pubnet account; never require live secrets for CI.
5. Close every discovered gap, repeat all gates, update user-facing documentation, and commit `docs(merchant): document verified merchant operations`.
