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
