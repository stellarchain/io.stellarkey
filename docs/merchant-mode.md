# Merchant Mode operations

Merchant Mode is a local-first, single-device point of sale for a Stellar wallet. It records counter activity in this browser and sends crypto payment requests directly to the merchant's selected Stellar account. It is not a hosted processor, custody service, or multi-terminal backend.

## Set up a till

1. Unlock the wallet, select the intended network and receiving account, then open **Settings → Merchant Mode**.
2. Enter the shop identity, display currency, accepted Stellar assets, tax behavior, tip behavior, and terminal name.
3. Create the owner PIN. Staff PINs protect local till roles; they are not wallet credentials and cannot sign Stellar transactions.
4. Add any required trustlines through the wallet's normal reviewed signing flow.
5. Open a shift with its opening cash float before taking payments.

Setup is committed as one operation. Cancelling or failing validation does not leave a partly configured till.

## Take and reconcile payments

- **Cash:** record the amount received; the receipt retains exact change.
- **External card:** record the other terminal's reference. This app does not claim to contact or settle that card terminal.
- **Split tender:** record the completed local leg first. A crypto request is created only for the exact remainder.
- **Crypto:** the app creates an expiring Stellar request with an exact memo and asset quote. An order settles only after Horizon reports a matching incoming payment to the configured account.

Underpayments, overpayments, late arrivals, duplicate references, and ambiguous memo-less payments remain visible for an audited decision. Replaying the same Horizon payment cannot settle or decrement stock twice.

## Staff, refunds, and shifts

An unlock or reload intentionally clears the active till operator. Select the staff member and enter their PIN before performing permissioned work. Five incorrect PIN attempts impose a timed local lockout.

Refund ceilings are role-based. An over-ceiling refund becomes an immutable approval request; approval still leads to the wallet's explicit transaction review and signature. A submitted refund remains pending until its Stellar transaction is confirmed, and the app never advises blind resubmission while status is unknown.

X reports are live readings. Closing a shift requires a blind drawer count and writes an immutable Z report with its variance. Unresolved tender or approval work blocks close.

## Invoices, counter codes, and customers

Issued invoices lock their Stellar quotes so the destination, memo, asset, and amount remain reproducible. Manual payments retain the acting staff member. Counter codes keep stable references; fixed codes retain their publication quote, while open codes require attributable pricing before filing a payment.

Settled payer addresses can create a local customer record. Contact names, notes, and loyalty events stay on this device. **Forget This Customer** removes local profile data but keeps pseudonymous financial history required for the till audit.

## Reports and settlement

Tax records and insights are derived from persisted orders, refunds, adjustments, tenders, assets, and stored tax arithmetic. CSV and JSON exports use exact amounts and retain network and ledger identity where applicable.

Settlement rules are reminders and prepared handoffs, never signing authority. A conversion opens the wallet's Swap review; a treasury sweep opens Send review. Nothing moves unattended.

## Offline and hardware behavior

When offline, the till keeps local cash/card operations but pauses confirmation and blocks a new crypto request when it cannot price or safely verify it. Reconciliation resumes after the browser returns online. A Horizon outage is shown separately from missing DEX liquidity.

Browser print/AirPrint, downloads, keyboard-wedge scanners, and the protected same-device customer display are supported. Direct ESC/POS, Bluetooth, cash-drawer, and synchronized external-display control require an external bridge and never report success without one.

## Local-data and release safety

- Merchant operational data is encrypted, committed transactionally in IndexedDB, and browser-local. It does not synchronize or form part of a hosted backup.
- Payment monitoring is foreground-only. An open, awaiting checkout requests Screen Wake Lock when supported and reconciliation resumes after visibility returns, but a closed or suspended browser cannot keep watching Horizon without a backend.
- Resetting the wallet removes wallet-owned merchant storage. Export required records first.
- Verify the network, receiving account, issuer, memo, amount, and signing-device details before authorizing a mainnet transaction.
- Serve installed or production deployments over HTTPS. A raw LAN HTTP origin cannot provide every iOS secure-context capability.

Before release, run `npm run release:verify` and complete the current checks in [Backend-free wallet release checklist](release-checklist.md).
