# iOS Tax Records Hub Design

## Intent

Tax Records becomes a calm records-management hub instead of a long form. The first screen answers the questions a merchant asks most often: which period is selected, what tax is due, how much was sold or refunded, and where reports and retained records are managed. Existing calculations, truthful export limitations, encrypted local storage, and backend-free operation remain unchanged.

## Information architecture

The page uses one compact navigation bar followed by a current-period summary. On iPhone, content is a single column of inset grouped sections. On iPad and desktop, the same sections form a two-column grid: the period snapshot and tax-by-rate breakdown remain prominent, while records-management actions sit alongside them. The layout does not turn into a dense desktop dashboard.

The root page contains summaries and disclosure rows only. Rates, report export, encrypted archive, retention, export history, and compliance information each have a clear destination. Frequently read figures stay visible; infrequently changed values and multi-field tasks move into focused sheets.

## Interaction model

A single sheet state ensures only one modal task can be active. Export configuration owns format, date range, basis, preview, and download. Retention owns the local retention preference. The encrypted archive sheet explains its scope before download. Rates and export history are read-only detail sheets. Compliance is a short informational sheet. Sheets close before another destination opens, preserve the shared modal focus behavior, and retain 44-point touch targets.

The page keeps visible empty states for missing periods, missing tax rows, and an empty export history. Values use tabular figures. Destructive or irreversible claims are avoided: exports are described as local evidence files, unavailable formats remain disabled, and the app continues to state that it is bookkeeping support rather than tax advice or certified invoicing software.

## Verification

Source tests define the summary-first hierarchy, single active sheet model, iPad grid, and absence of direct root-page form controls. Playwright covers the mobile export-sheet journey and horizontal-overflow regression. The complete unit suite, TypeScript, lint, production build, bundle budget, and relevant WebKit/mobile journey must pass before merge.
