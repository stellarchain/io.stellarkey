# ADR 0007: Keep ZK Pool and Stealth Payments as Distinct Tools

## Status
Accepted

## Context
The application contains two privacy systems. The shielded Soroban pool hides note ownership,
internal amounts, recipients, and lane roles for one asset-pinned pool, at the cost of setup,
proving, recovery scanning, and contract state. The Horizon stealth path derives a fresh one-time
classic account from a reusable meta-address without a proof or pool, but leaves the transferred
asset, amount, source, timing, and eventual sweep behaviour public.

The audited implementation is active rather than abandoned: eight `stealth-*.ts` runtime modules
contain 1,661 lines and the browser primitive adds 306 lines. Receive and receipt interfaces use it
for reusable native-asset receipt flows. Removing it would eliminate a lower-latency recipient-
unlinkability option that the pool does not replace on the same operational terms.

## Decision
Keep both systems, but describe them as complementary rather than interchangeable:

- Use the ZK pool when the supported asset, proving delay, testnet-only status, and recovery model are
  acceptable and shielding internal amount and ownership links is required.
- Use a stealth meta-address for reusable native-asset receipt unlinkability without proving. Never
  claim that it hides amount, sender, asset, timing, account creation, or sweep linkage.

Keep their key derivation, storage, sync, recovery, status, and user-facing terminology separate.
Do not silently route a failed pool payment through stealth or vice versa.

## Consequences
- Both code paths remain intentional security surface and require independent tests and review.
- Product copy must state the narrower stealth guarantee and the stronger but more expensive pool
  guarantee.
- Consolidation can be reconsidered after measured beta usage and failure data exist.
