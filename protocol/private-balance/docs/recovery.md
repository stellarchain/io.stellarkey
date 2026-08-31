# Canonical Recovery Transcript (V1)

## 1. Structure
- Every accepted on-chain action appends an `ArchiveRecord`.
- Up to `PAGE_CAPACITY` (32) records are packed into an `ArchivePage`.
- Pages form an authenticated SHA-256 hash chain anchored by `ArchiveMeta.transcriptHead`.
- Recovery scans pages sequentially, opens recipient envelopes with the wallet HPKE private key, recomputes commitments, and matches nullifiers.
