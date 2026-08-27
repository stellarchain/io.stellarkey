# Asset Favorite Modal Design

## Intent

Favorite management belongs in the asset detail modal, not in every Home asset row. The Home list remains a clean, single-tap navigation surface while favorites continue to sort ahead of other assets.

## Interaction

Opening an asset exposes one full-width favorite action directly below the balance summary. The action shows a filled gold star and “Remove from favorites” when selected, or an outlined neutral star and “Mark as favorite” otherwise. It uses `aria-pressed`, an asset-specific accessible label, a 44-point minimum target, and the existing selection haptic.

The dashboard remains the owner of favorite persistence and ordering. It passes the selected asset’s favorite state and its existing toggle callback to `AssetDetailModal`; no storage key, migration, backend, or sorting behavior changes. The dashboard list removes the independent star button so tapping anywhere in an asset row opens the modal.

## Verification

A source regression test must fail against the old placement, then prove that the dashboard list contains no favorite button while the modal owns the accessible pressed control and receives state through explicit props. TypeScript, lint, the full test suite, production build, and bundle budget must pass before merging to `main`.
