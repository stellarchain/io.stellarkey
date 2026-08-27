# Dual-Input Swap and Completion Design

## Outcome

The swap screen will treat the last edited amount as the user’s exact intent on every viewport. Editing **You pay** requests a Stellar strict-send route: the debit is exact and slippage defines the minimum credit. Editing **You receive** requests a strict-receive route: the credit is exact and slippage defines the maximum debit. The quoted field remains editable, so selecting either field naturally changes the intent without a separate mode control.

This mirrors a modern exchange while retaining Stellar’s transaction guarantees. The quote identity will include the intent side, assets, exact amount, network, and slippage so an old response can never be reviewed or submitted after another field changes. Exact-receive quotes must also prove their slippage-adjusted maximum debit fits the wallet’s spendable balance.

## Responsive interaction

Both amount cards will share one responsive component. Each card owns a compact label and balance row, followed by a `minmax(0, 1fr)` amount column and a bounded asset selector. Amount typography will scale with the viewport, long numbers will remain inside the card, and percentage shortcuts will use an even four-column grid. The cards remain stacked on desktop and mobile because the vertical pay-to-receive flow is clearer than a side-by-side trading form; desktop gains breathing room while mobile removes collisions and redundant gutters.

Quote analytics and review rows will wrap exact values rather than truncate them. Copy will change with the active guarantee: “Minimum received” for exact-pay swaps and “Maximum paid” for exact-receive swaps. Route source text will identify strict-send or strict-receive accurately.

## Completion experience

After submission, the editable form is replaced by a focused status surface. While confirmation is pending it shows a progress state and canonical transaction hash. Once confirmed it becomes a receipt-style success view containing the debit, credit, execution mode, route, network, fee estimate, and transaction identity. It retains the immutable submitted quote rather than reading reset form state.

The success view provides three clear exits: **Done** returns home, **View activity** opens the bank-style activity feed, and **Swap again** resets the form. No backend is introduced; confirmation continues through the wallet’s existing local pending-transaction tracker and direct Horizon requests.

## Failure and test boundaries

No-route and Horizon-outage states remain distinct. A failed on-chain swap returns to an editable form with the prior intent intact. Exact-receive route selection uses the lowest source amount at full seven-decimal precision, and send maximum calculation rounds upward so the displayed limit cannot understate transaction authority.

Automated coverage will include strict-receive query construction, route selection, transaction XDR, slippage rounding, quote binding, both editable fields, 320px containment, exact guarantee copy, and the confirmed receipt flow. The full static release gate remains required.
