# Canonical Encoding Specification (V2)

## 1. Rules
- Fixed-width big-endian integers (u16, u32, u64, u128, i128).
- Canonical field elements as 32-byte unsigned big-endian integers $< Fr$.
- Length prefixes for domain strings (u16 BE) and variable bytes (u32 BE).
- Addresses: 1-byte kind (0 = Ed25519, 1 = Contract) + 32-byte payload.
- Optional addresses: 1-byte presence (0 = absent, 1 = present) + 33-byte canonical address (34 bytes total).

## 2. Global positions

Archive action indices and starting leaf indices are 16-byte u128 big-endian
values. Ledger sequence and asset registry index remain four-byte u32 values.
Note nullifier inputs bind the complete global position as a canonical field
element, not a truncated 32- or 64-bit position. Browser global positions are
BigInt; persisted JSON uses canonical unsigned decimal strings with no leading
zeros (except `0`), bounded by `2^128 - 1`. Action kinds are Deposit=1, Transfer=2,
Withdraw=3, FullInputExit=4. Primitive domain labels ending in V1 are retained
unchanged; the encoded protocol version and fresh context distinguish V2.

The FullInputExit record has the same three output-package fields as other
actions, but inserts none. Its starting leaf index and resulting root equal the
prior tree state. Its action index and chained digest still advance.
