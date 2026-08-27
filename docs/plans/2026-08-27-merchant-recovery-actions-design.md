# Merchant Recovery Actions Design

Merchant blockers should offer the shortest safe path into the existing flow that resolves them.

When the global charge warning says an active staff member is required, show a compact `Choose staff` action in the warning. The action navigates directly to Settings → Merchant → Staff & this device, where the existing PIN-verified staff switch remains authoritative. Do not duplicate staff selection or weaken PIN verification inside the till.

When the till has no open shift, show an `Open shift` button in the till status card. The action opens the existing `ShiftSheet`, preserving staff permissions, opening-float entry, audit attribution, and validation. The warning text remains visible and the button retains a minimum 44px touch target.

Pass these actions down from `Dashboard`, which already owns both deep settings navigation and the shared shift-sheet state. No merchant records, blocker rules, or backend boundaries change.

