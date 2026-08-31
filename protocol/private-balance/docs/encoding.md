# Canonical Encoding Specification (V1)

## 1. Rules
- Fixed-width big-endian integers (u16, u32, u64, i128).
- Canonical field elements as 32-byte unsigned big-endian integers $< Fr$.
- Length prefixes for domain strings (u16 BE) and variable bytes (u32 BE).
- Addresses: 1-byte kind (0 = Ed25519, 1 = Contract) + 32-byte payload.
- Optional addresses: 1-byte presence (0 = absent, 1 = present) + 33-byte canonical address (34 bytes total).
