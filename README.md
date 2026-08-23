# Stellar Wallet

A self-custodial Stellar wallet built with Next.js 16, React 19, and `@stellar/stellar-sdk` 17. Vault encryption, transaction construction, and signing happen in the browser. The app talks directly to Stellar Horizon and never sends secret keys or recovery phrases to an application server.

## Supported capabilities

- Mainnet and testnet balances, activity, trustlines, claimable balances, payments, batch payments, account merge, and Stellar DEX strict-send swaps
- Exact seven-decimal Stellar amount arithmetic, typed memos, live base-reserve calculation, multisig envelopes, and SEP-7 unsigned payment links
- Password-encrypted local vaults and backups, encrypted private transaction notes, watch-only accounts, inactivity auto-lock, and complete local reset
- Trezor address discovery and on-device Stellar signing through the official Trezor Connect popup

Ledger signing is not implemented and is intentionally unavailable. The app never creates a simulated Ledger account. Biometric unlock is also unavailable until it can be backed by a real passkey or smart-account authorization flow.

## Asset and price safety

Credit assets are identified by the complete `(network, code, issuer)` tuple. A matching code alone is never treated as verified or assigned a price. The built-in directory currently contains Circle USDC on mainnet/testnet and EURC on testnet only; custom assets always expose their issuer.

Portfolio values are shown only for mainnet assets with a verified price mapping. Testnet balances are never assigned monetary value. XLM, verified asset prices, and fiat exchange rates come from live CoinGecko data and are cached briefly in memory.

## Local development

Requires Node.js 22 or later.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Verification commands:

```bash
npm test
npm run typecheck
npm run lint
npm run audit:prod
npm run build
```

CI runs the same checks on pushes and pull requests.

## Security and deployment notes

- Serve the production build over HTTPS. Custom Horizon URLs should also use HTTPS.
- Security headers are configured in `next.config.ts`, including CSP, clickjacking protection, MIME sniffing protection, a restrictive permissions policy, and popup-compatible cross-origin isolation for Trezor Connect.
- The CSP permits outbound HTTPS because users can configure a Horizon endpoint and asset metadata/logos may live on issuer domains.
- Reset deletes all `polaris.*` and `wallet.*` browser storage owned by this app. Back up the recovery phrase or encrypted backup before resetting.
- SEP-7 callback requests and signed/origin-domain requests are rejected until the app can execute and verify those flows fully.
- The Trezor dependency tree has no known high or critical production advisories after the pinned `protobufjs` remediation. Remaining low-severity upstream findings are enforced below the CI failure threshold.

This remains financial software: test every release with small amounts and verify addresses, asset issuers, memos, network, and transaction details on the signing device before broadcasting.
