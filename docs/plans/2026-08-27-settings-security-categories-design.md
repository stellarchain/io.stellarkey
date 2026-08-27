# Settings Security Categories Design

## Goal

Replace the single eight-row “Security & Backup” list with four smaller, clearly named groups while preserving every control, value, action, and the existing responsive two-column Settings layout.

## Information architecture

- **Recovery:** Backup & Recovery.
- **Device Security:** Touch ID / Face ID and Auto-Lock Timer.
- **Signing Security:** Multi-Sig Studio, Hardware Wallets, and Local XDR Signer.
- **Privacy & Feedback:** Hide Balances (Privacy) and Audio & Haptic Feedback.

The order prioritizes recovery first, then routine device protection, advanced signing tools, and lightweight presentation preferences. The right-side Accounts, Merchant, Network, App, and Danger Zone groups remain unchanged.

## UI and accessibility

Each category is a semantic `section` with a visible `h2` label and its own `list-group`. Separators appear only between rows inside the same group. The left column uses the existing six-unit vertical rhythm, so mobile gains scannability without extra card padding or nested panels. Desktop keeps the current two-column grid.

No navigation, passkey capability checks, toggles, backup health text, haptics, or callbacks change. Pinch zoom remains disabled.

## Verification

The mobile browser journey must expose all four category headings and no longer expose “Security & Backup.” Existing settings accessibility, responsive overflow, and release checks must remain green.
