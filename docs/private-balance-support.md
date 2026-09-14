# Private Balance support boundaries

Private Balance support is safe only when the report is sanitized. Use the
protected support or security action on `stellarkey.io`; suspected vulnerabilities
must not be filed publicly.

Support may ask for:

- StellarKey version and public build commit;
- browser, operating system, selected network, and whether the app is installed;
- the public pool contract ID, manifest hash, and artifact version;
- a public ledger sequence or transaction hash;
- a stable redacted error code and the step that produced it; and
- whether encrypted-backup or seed-only recovery was selected.

Support will never ask for a recovery phrase, secret key, vault password,
private address, viewing key, note plaintext, witness, proof inputs, encrypted
backup, decrypted backup, or screen recording that exposes them. Do not paste
IndexedDB, localStorage, worker messages, full transaction drafts, or browser
memory into an issue.

Before reporting, verify the exact HTTPS origin and release commit, lock the
wallet, preserve the encrypted backup, record only public hashes, and reproduce
with an unfunded testnet account when possible. If a transaction is ambiguous,
check its public hash and current nullifier/archive state; do not submit it again
just because the interface timed out.

## A preparation fee exceeds the approved limit

The action resource-fee cap is 10,000,000 stroops (1 XLM). Do not increase it or
repeat a payment to work around a fee-limit error. Check existing private activity
first; a previously disclosed spend proof must remain reserved until canonical
reconciliation, regardless of a later simulation failure.

An idle pool's shared contract code and instance can be archived. A read-only
simulation may restore them virtually without activating them on-chain; the
next action can therefore still include their restoration cost. A successful
getter alone does not establish that an action fits its fee cap.

For a suspected archived deployment, compare the public code and instance keys,
their live-until ledgers, and fresh simulation fees through independent,
network-matched RPCs. Verify the manifest deployment binding and code hash. This
check does not require wallet secrets, private addresses, proof inputs, or a
user transaction.

An operator may separately restore those exact public entries using a maintenance
account, only with explicit network and spending approval. Simulate the exact
restore footprint immediately before signing, enforce the approved total fee,
and require ledger confirmation before reporting restoration. Recheck both RPCs
for live entries, unchanged code/instance data, and fresh fees. Never interpret
submission acceptance or a timeout as confirmation, or automatically repeat an
uncertain submission. Monitor the returned TTL: restoration is finite, and any
later restoration or TTL extension needs its own bounded maintenance approval.

## Choosing a network-fee account

Private deposits, sends, withdrawals, multi-step sends and held-balance recovery
default to the current account for network fees. Another software account in
the same wallet can pay through a locally signed fee-bump envelope. Selecting it
does not switch the wallet account or move its private funds. Both public
accounts are visible on Stellar; this is not a relay or an identity-hiding mode.

The payer needs public XLM on the selected network after its reserve and selling
liabilities. Watch-only accounts cannot sign, and this build does not support
hardware private fee signing. If an account disappears or its signing identity
changes, choose again and create a fresh review; the wallet does not fall back
to a different payer. Any already shared spend proof remains held.

The review's unsigned inner hash differs from a sponsored transaction's final
hash. The wallet journals both and tracks the submitted outer envelope for
confirmation and resume. A pending or uncertain result is not ledger confirmation.

## Receive requests and local privacy advice (Unreleased)

The current development build creates a fresh shielded receive address when a
new receive opening explicitly selects Private. Merely focusing the tab does
not request an address. Switching tabs or assets within the same pool does not
request another rotation. **New address** starts another request in place.
If another flow replaces the saved address while this panel is away, returning
requires a new request or explicit reuse instead of silently adopting that address.
The address is published only after encrypted issuance is saved. Previous
addresses remain valid and recoverable; opening Receive does not move funds.

If fresh issuance is unavailable, **Reuse Saved Address** is an explicit fallback,
including while offline. Its warning explains that repeated use can correlate
payments on-chain through the clear diversifier. Retry does not silently choose
reuse. Rotation does not provide forward secrecy if the recovery phrase or
viewing key is compromised. An account, session, or deployment change invalidates
the displayed request and its QR; late results cannot populate the new context.

Deposit forms and reviews suggest considering rounder amounts when more than
two decimal places are used. Withdrawal forms and reviews warn if the amount
matches a deposit of the same asset in available local history, or if that
history records a deposit of the asset within the past 24 hours. Missing or
unavailable historical timestamps do not count as recent deposits.

These checks use already available history on the device: they do not upload
history, issue new RPC queries, or store another payment log. They do not change
amounts, split payments, delay broadcasts, or prevent confirmation. The 24-hour
window is a warning heuristic, not a privacy threshold. The absence of a warning
does not establish unlinkability or a sufficient anonymity set. Waiting, rounding,
and splitting cannot guarantee privacy. Direct submission still exposes the
submitting account, and public withdrawals expose recipient, asset, and amount.

The release-pinned whitepaper continues to describe its named release; this
section and the changelog describe the unreleased wallet behavior.
