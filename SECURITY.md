# Security policy

StellarKey is financial software. Please report vulnerabilities privately and avoid actions that could expose another person's wallet or merchant records.

## Supported versions

Only the latest `1.3.x` release is currently supported with security updates. When a newer production release is published, older builds should be treated as unsupported unless a release notice says otherwise. Verify the deployed commit and checksums as described in the README before testing a report.

## Reporting a vulnerability

Start at <https://stellarkey.io/security> and use the protected contact action on that page. Do not open a public issue for a suspected vulnerability. Include the affected release and commit, browser and operating system, network, reproducible steps using testnet where possible, impact, and any suggested mitigation. Never include a recovery phrase, private key, vault password, real customer data, or a funded account.

We aim to acknowledge a complete report within three business days. Triage and remediation timing depend on severity and reproducibility. Please allow a reasonable remediation window before disclosure; coordinated publication details will be agreed with the reporter where practical.

## Safe-harbour scope

Good-faith research should use accounts and data you own, avoid privacy violations and service disruption, stop when sensitive data is encountered, and report findings promptly. This policy does not authorize testing third-party infrastructure such as Stellar public services, hosting providers, Trezor services, or asset issuers.

## Security model limits

StellarKey cannot reverse a Stellar transaction, recover a lost recovery phrase, decrypt a vault without its password or supported passkey path, or restore browser-local merchant data that was never exported. A compromised device, browser, extension, DNS record, release artifact, or recovery backup can defeat application-level protections.

## Private Balance reports

Private Balance is development-only and not enabled in the production wallet. A report may include its public pool ID, manifest or artifact hash, ledger sequence, public transaction hash, stable error code, and sanitized reproduction steps. Never include a private address, viewing key, note plaintext, witness, proof input, recovery phrase, or backup. See the [Private Balance support boundary](docs/private-balance-support.md) and [incident playbook](docs/private-balance-incident-response.md).
