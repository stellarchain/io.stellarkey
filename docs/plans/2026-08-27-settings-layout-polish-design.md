# Settings Layout Polish Design

## Goal

Make the multi-signature signer identity readable at every width and give Merchant Settings the same compact, categorized hierarchy as Wallet Settings without changing any merchant behavior.

## Signer identity

The signer address and the “This device” badge currently participate in the same inline flow. The badge can therefore begin immediately after the final address chunk. The badge will become a block-level, content-width label with a small top margin. This keeps the address on its own line and applies the same relationship in the overview and configuration views. The address remains Trezor-style, copyable, and truncated by the existing `HashValue` component; signer weight remains right-aligned.

## Merchant settings

The existing row controls already match Wallet Settings, so the controls and data flow do not need redesigning. The page hierarchy will change from one long list into the same responsive two-column category grid used on the wallet root. Shop, Money, Accepted Assets, and Settlement form the left column. Tax, Rates, Tips, Terminal, and the Merchant Mode danger action form the right column. Each column preserves its current section order, captions, advanced disclosures, validation, and callbacks.

At phone widths the grid collapses to a single column, retaining the current touch-friendly rows and avoiding horizontal overflow. The non-custodial explanation and receipt sheet stay outside the grid because they apply to the whole page.

## Verification

Source-level regression tests will assert that both local-device badges have an explicit block boundary and that Merchant Settings uses a responsive two-column grid with two categorized stacks. Type checking, the full unit suite, linting, and a production build will verify that the structural JSX change remains valid in the current Next.js static-export setup.
