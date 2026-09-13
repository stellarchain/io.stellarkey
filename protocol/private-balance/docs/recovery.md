# Canonical Recovery Transcript (V1)

## 1. Structure
- Every accepted on-chain action appends an `ArchiveRecord`.
- Each record occupies its own persistent contract-data entry keyed by action index.
- Records form an authenticated SHA-256 hash chain anchored by `ArchiveMeta.transcriptHead`.
- Recovery reads contiguous record batches, opens recipient and outgoing envelopes, recomputes commitments, and matches nullifiers.
