# Subtle Asset Favorite Design

The favorite action remains in the asset detail modal, directly below the balance summary, but it should read as a secondary preference rather than a featured card.

Use a compact, neutral action row with a minimum 44px touch target. Show a small outline or filled star beside the single label `Favorite`. Remove the gold card surface, explanatory subtitle, and `On`/`Off` copy. When selected, use restrained gold only on the star and show a small trailing checkmark; keep the row background and border neutral in both states.

The existing `aria-pressed` state, asset-specific accessible label, callback, local persistence, and favorite-first Home sorting remain unchanged. Regression coverage should assert that the modal keeps the accessible toggle while the loud subtitle and explicit status text are absent.

