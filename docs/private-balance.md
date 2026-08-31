# Private Balance security and privacy model

Private Balance is development-only in this repository and is not deployed or
enabled in the production wallet. Its checked-in manifest deliberately fails the
release gate. Do not change that status until the ceremony, audit, testnet, and
release evidence in the protocol plan exists for the same artifact hashes.

## What it is

Private Balance is a separate native-XLM shielded note pool. A supported
software wallet derives a deployment-bound viewing and spending context inside
the unlocked vault boundary. The browser reads the canonical encrypted action
archive from Stellar RPC, verifies its hash chain and Merkle root, opens only
notes addressed to the wallet, and creates proofs in an isolated worker.

There is no application backend, relayer, indexer, hosted key service, or
StellarKey database. Static application files and immutable proving artifacts
come from the application origin. Chain reads, simulation, submission, and
recovery go directly to the user's validated Stellar RPC endpoint.

## Public and private boundaries

Private transfers hide the recipient, amount, and which private notes were
spent. The pool contract, asset, proof, root, commitments, nullifiers, encrypted
output packages, and action timing remain public. The fee-paying Stellar account
and its network fee are public. Deposits and withdrawals additionally reveal the
public endpoint and amount. Reusing a private address lets recipients correlate
that address off-chain.

The RPC operator and network observer can see the user's IP address, request
timing, selected pool, ledger ranges, simulations, and submitted transactions.
Pool size, deposits, withdrawals, timing, repeated endpoints, browser compromise,
or voluntary disclosure may allow correlation. A malicious extension, device,
origin, dependency, artifact, or approved transaction can defeat browser-level
protections.
Timing and pool activity remain public even when note plaintext stays local.

## Local data

Owned notes, decrypted activity, recovery progress, checkpoints, and pending
actions are encrypted and authenticated in deployment-bound IndexedDB records.
The optional public cache contains only public commitments and other verified
chain material, is disposable, and is excluded from backups. Lock, account or
network change, lease loss, manifest rejection, and runtime failure clear the
in-memory private state and terminate the worker.

Use exact integer stroops for protocol and balance calculations. A balance is
current only after the final archive head, action count, transcript, and Merkle
root reconcile. An incomplete scan may show the last verified balance but must
not permit a spend.

See [recovery](private-balance-recovery.md), [safe support](private-balance-support.md),
and the [incident playbook](private-balance-incident-response.md).
