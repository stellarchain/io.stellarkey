# Private-protocol implementation

Execution of the three approved privacy plans, started from `3e8dca7d021767138bc21c790f7ef59cc2fce309` on 2026-09-06. Original planning documents in the main checkout are preserved. Implementation is isolated on `advisor/001-revoke-stealth-discovery`; the user requested continuing through every plan without routine approval checkpoints. Separate logical commits and independent reviews retain the intended delivery boundaries without merging between temporary branches.

| Plan | Scope | Status |
| --- | --- | --- |
| [001](001-revoke-stealth-discovery.md) | Revocable discovery, stale-publication protection and atomic local removal | Implemented and independently approved; 54/54 discovery browser regressions passed |
| [002](002-viewing-only-stealth-discovery.md) | Viewing-only material during network discovery | In progress after reviewed 001 and real persistence-race gate |
| [003](003-owned-secret-buffer-cleanup.md) | Owned key/plaintext scratch-buffer cleanup | Implemented; spec and quality reviews passed; final integrated verification pending |

No transaction, deployment, push, main-branch merge or user-server restart is part of this execution. Shared proof reservations and already-consented signing journals keep their existing authority. Cryptographic vectors, addresses, schema and dependencies must remain unchanged.

Release limitation: the fresh production dependency audit reports 13 existing transitive findings (8 low, 5 high), including `toml` under Trezor's older nested Stellar SDK and `elliptic`. No lockfile change or automatic dependency upgrade is included. This blocks clean release certification, not implementation of the scoped fixes.
