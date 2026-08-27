# Active Checkout Wake Lock Design

Merchant payment reconciliation remains foreground-only and continues to poll Horizon whenever Merchant Mode is open. Returning to a visible, unlocked app still triggers a catch-up poll, independently of the Screen Wake Lock API.

Remove the permanent foreground-monitoring banner from the Merchant shell. It exposes an implementation constraint on every merchant subpage, conflates payment polling with screen-awake protection, and requests a wake lock even when no customer is checking out.

Move screen-awake ownership into the open `ChargeSheet`. Acquire it only while that sheet displays an awaiting charge; release it when the sheet closes or the charge settles, expires, or is cancelled. Reuse the sheet’s existing compact live-status row and rename its awaiting state to `Watching for payment`. Do not show a success banner for the wake lock. If an attempted lock fails or is released while the checkout remains open, show a small retry action inside the sheet. Unsupported browsers remain truthful by making no screen-awake claim.

The Horizon watcher, visibility reconciliation, wallet auto-lock preference, payment matching, and backend-free architecture do not change.

