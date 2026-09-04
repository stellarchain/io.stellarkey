# Private Relay Presence Design

## Goal

Let a person check whether privacy-relay wallets are reachable before starting a payment, see the fees they currently advertise, and then choose a fresh offer by fee inside the actual payment flow.

## Privacy and accuracy model

StellarKey wallets do not maintain direct peer-to-peer connections. They exchange short-lived, signed messages through configured public Nostr relays. The UI must therefore avoid the phrase “connected peers,” which would imply a durable connection that does not exist.

An explicit **Check available peers** action sends the same anonymous request used to collect transaction quotes. The request contains the network, pool, action kind, an ephemeral reply key, and expiry; it contains no StellarKey account, asset, amount, destination, note, proof input, or transaction. A wallet is counted only if it returns a valid encrypted quote during the bounded response window. Results stay in React memory and are discarded when the modal closes or a new check starts.

The check is never automatic. Background polling would continuously reveal the user’s IP and timing to the configured Nostr relays and would create unnecessary traffic. The UI says “available when checked,” shows the check time, and explains that availability can change before payment.

## Interface

The existing **Earn by relaying** modal gains a flat **Relay network** section above the settings form. Its independent states are:

- Idle: “Not checked” and a **Check available peers** button.
- Checking: stable shell, progress label, disabled duplicate action, and an accessible live announcement.
- Result: “N peers available when checked,” check time, and one row per unique peer showing the public source account and fee in ordinary seven-decimal payment-asset units.
- Empty: “No peers answered” without claiming the network is offline.
- Error: a safe retry message without echoing relay payloads or addresses.

Rows are ranked by fee and the first is labelled **Lowest fee**. This status view is informational: it does not persist a favourite or bind a stale quote. During send or withdrawal, StellarKey obtains fresh quotes, displays them in the existing picker, and requires an explicit selection. The same lowest-fee label is added there.

## Lifecycle and abuse controls

The probe always closes its ephemeral session in a `finally` block, including on cancellation and errors. Duplicate replies from the same public Stellar source account collapse to its lowest valid quote, collection stops at 32 unique accounts, and expired quotes are excluded. Helper-side quote and request caches are pruned after expiry so repeated checks cannot consume the bounded open-quote capacity indefinitely.

## Verification

Unit tests cover quote ranking, duplicate collapse, expiry filtering, session cleanup, and cancellation. Source-level interaction tests cover the explicit-only check, stable status states, accessible announcements, fee display, lowest-fee marker, and absence of persisted peer selection. Focused tests, TypeScript, lint, the full suite, production build, and bundle budgets run before integration.
