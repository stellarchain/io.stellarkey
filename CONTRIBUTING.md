# Contributing to StellarKey

Thank you for helping improve StellarKey. Changes should preserve the wallet's self-custodial, backend-free architecture and make security boundaries understandable to ordinary users.

## Before you start

- Open an issue for a substantial behavior or architecture change so the security model can be discussed first.
- Report vulnerabilities through the private process at <https://stellarkey.io/security>. Do not put secrets, recovery phrases, private keys, customer records, or exploitable details in an issue or pull request.
- Use testnet accounts and disposable test data when reproducing a problem.

## Development workflow

Use a supported Node.js and npm version from `package.json`, then install and test:

```bash
corepack install
corepack npm ci
npm run dev
npm run release:verify
```

Add a regression test before fixing a defect. Keep changes focused, preserve encrypted-backup compatibility unless a migration is explicitly designed, and update operational documentation when behavior changes. The full release gate must pass before a change is released. Hardware-wallet and installed-PWA behavior must also be checked on real devices when affected.

## Developer Certificate of Origin

StellarKey uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/) instead of a separate contributor agreement. Sign off every commit to certify that you have the right to submit the contribution under this project's license:

```bash
git commit -s
```

The resulting `Signed-off-by` line must use an identity you are entitled to use. Contributions are licensed under `AGPL-3.0-or-later` unless a file clearly states different terms.

## Dependency and hardware-wallet policy

New runtime dependencies require a security, maintenance, size, and license review. Do not copy separately licensed third-party source into StellarKey. The optional Trezor integration must remain isolated behind its adapter and must not be described as AGPL-covered; see `THIRD_PARTY_NOTICES.md` before changing or distributing that integration.

By participating, you agree to follow `CODE_OF_CONDUCT.md`.
