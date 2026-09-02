# Private Balance recovery

Private Balance has two local-first recovery paths. Neither requires an
application backend.

## Encrypted backup restore

A full StellarKey encrypted backup includes deployment-bound sensitive Private
Balance records but excludes the disposable public cache. Restore authenticates
the complete archive in staging, derives the storage key again from the restored
wallet account, rejects swapped or incompatible deployment records, and rolls
back every browser store if any record fails. Restored notes remain locked until
the current manifest and canonical chain head reconcile.

An encrypted backup preserves local activity metadata. Store it separately from
the password, verify it in a fresh browser profile, and never send it to support.

## Seed-only network recovery

The wallet seed can derive the same deployment-bound viewing key. Seed-only
recovery reads the canonical on-chain archive from page zero, verifies every
page and record hash, rebuilds the authenticated incremental Merkle store,
opens owned ciphertext, authenticates outgoing envelopes, and checks public
nullifiers. It restores spendable value and exact owned amounts. For outgoing
transfers it also restores the external recipient fingerprint and memo from
seed plus chain data; the full reusable private address is intentionally not
retained as activity metadata.

Old persistent archive pages may need a normal Stellar restore-footprint
transaction. The wallet freshly simulates contiguous exact keys and selects the
largest safe prefix within the configured footprint and 80% resource margin,
shows the restoration fee separately, applies a cumulative fee ceiling,
waits for final status, rereads each page directly, and persists an encrypted
resume cursor. It never restores temporary known-root entries.

## Interrupted actions

Chain transcript and nullifiers are authoritative. After a crash or ambiguous
submission, reserved notes remain unavailable until the transaction reaches a
definitive result or a fresh scan proves their nullifiers absent. Never retry a
private spend blindly. After any restoration preamble, discard the old
simulation and proof intent, reread chain state, and build a fresh action.
