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
