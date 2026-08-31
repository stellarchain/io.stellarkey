# Merchant Muxed Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace human text-memo settlement routing with muxed-account routing while retaining a `MEMO_ID` compatibility request for Trezor and other legacy signers.

**Architecture:** A local routing module owns uint64 validation, generation, muxed-address encoding, and transport request construction. Merchant domain records persist a routing ID and all reconciliation code consumes a normalized routing identity. Wallet payments accept `G...` and `M...` destinations while Horizon account checks use the underlying `G...` account. Merchant UI keeps the muxed request primary and offers the equivalent compatibility request without changing the charge identity.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, `@stellar/stellar-sdk` 17, Node test runner, Playwright.

---

### Task 1: Routing primitives

**Files:**
- Create: `src/lib/merchant/routing.ts`
- Create: `tests/merchant-routing.test.mjs`

1. Write failing tests for uint64 validation, random non-zero IDs, muxed encoding, base-address extraction, and preferred/compatibility transport equivalence.
2. Run the new test and confirm it fails because the module is absent.
3. Implement the smallest routing module that makes it pass.
4. Run the focused test and commit.

### Task 2: Merchant persisted records and SEP-7 requests

**Files:**
- Modify: `src/lib/merchant/types.ts`
- Modify: `src/lib/merchant/schema.ts`
- Modify: `src/lib/merchant/defaults.ts`
- Modify: `src/lib/merchant/charge.ts`
- Modify: `src/lib/merchant/invoices.ts`
- Modify: `src/lib/merchant/counter-codes.ts`
- Modify: merchant charge, invoice, counter-code, and schema tests

1. Add failing assertions that new records receive immutable routing IDs and preferred requests use `M...` destinations without memos.
2. Add failing assertions that compatibility requests use the underlying `G...` destination and `MEMO_ID` with the same ID.
3. Advance the unreleased merchant schema and add routing IDs to payable records.
4. Update constructors and URI builders, preserving human references only in display messages.
5. Run focused domain and schema tests and commit.

### Task 3: Watcher normalization and deterministic matching

**Files:**
- Modify: `src/lib/merchant/watch.ts`
- Modify: `src/lib/merchant/match.ts`
- Modify: `src/lib/merchant/reconciliation.ts`
- Modify: `src/lib/merchant/invoices.ts`
- Modify: `src/lib/merchant/counter-codes.ts`
- Modify: watcher, matching, invoice, counter-code, and reconciliation tests

1. Add failing fixtures for `to_muxed_id`, `from_muxed`, `MEMO_ID`, agreeing dual transport, and conflicting dual transport.
2. Normalize inbound records into `routingId` and `routingConflict`.
3. Match charges, invoices, and counter codes by routing ID before the guarded amount lane.
4. Preserve muxed payer addresses where Horizon provides them, so returns can retain payer routing semantics.
5. Verify conflicts remain unmatched and commit.

### Task 4: Wallet muxed-destination payments

**Files:**
- Modify: `src/lib/vault.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/components/SendModal.tsx`
- Modify: `src/components/BatchSendModal.tsx`
- Modify: wallet domain and UI tests

1. Add failing tests that payment validation accepts `M...` while account-management validation remains `G...` only.
2. Add failing tests that Horizon loads the underlying account and the payment operation retains the `M...` destination.
3. Reject account activation through a muxed destination with actionable copy.
4. Add explicit Trezor guidance rather than passing an unsupported classic muxed payment to the device.
5. Run focused wallet tests and commit.

### Task 5: Merchant payment UI and terminology

**Files:**
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/ChargeSheet.tsx`
- Modify: `src/components/merchant/InvoiceDetailModal.tsx`
- Modify: `src/components/merchant/CounterPosterModal.tsx`
- Modify: related merchant detail components and UI tests

1. Add failing tests for preferred and hardware-compatible request access.
2. Keep the preferred muxed QR primary and add a compact hardware-wallet compatibility action.
3. Replace memo-routing terminology with payment-routing terminology in merchant activity and reconciliation UI.
4. Keep existing dialog identity and transaction state behavior stable.
5. Run focused UI tests and commit.

### Task 6: Release documentation and verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: relevant architecture/security documentation if existing claims require it

1. Add concise `[Unreleased]` entries describing muxed merchant routing, the compatibility request, and wallet `M...` payment support.
2. Run merchant tests, wallet domain tests, typecheck, lint, production build, and targeted Playwright coverage.
3. Inspect the diff for unrelated changes and sensitive data.
4. Use the verification and branch-finishing workflows before offering merge options. Do not push without explicit approval.
