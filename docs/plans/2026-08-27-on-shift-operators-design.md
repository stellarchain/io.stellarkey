# On-shift operators design

## Outcome

Merchant Mode supports several operators working on one local till while keeping exactly one person accountable for every sale or privileged action.

## Product model

- **On shift** is a local, encrypted roster of staff available on this device.
- **Current operator** is the one PIN-verified staff member whose permissions and identity apply to the next action.
- Choosing a staff member always verifies their personal PIN. A shared PIN is not introduced.
- Locking clears the current operator but leaves the on-shift roster available for fast selection.
- Ending an operator's session removes them from the roster. Historical orders and reports remain unchanged.
- Operator locking is configurable as either after every completed sale or after a short inactivity period.

## Interface

Replace the persistent select/PIN form with one compact **On this shift** surface:

- a prominent current-operator row with avatar, role, status, and a Lock action;
- a touch-friendly horizontal roster of operators already on shift;
- a restrained Add operator action for active staff not yet on shift;
- a PIN modal shown only when somebody is selected;
- a separate Locking modal for the security policy;
- roster management that removes staff without exposing staff administration controls.

The full Staff list remains below for owners to edit roles, permissions, and PINs.

## Local-only architecture

`MerchantStore.onShiftStaffIds` persists the roster inside the existing encrypted merchant store. `activeStaffId` remains the selected operator, while the existing in-memory `staffSessionId` remains the proof that a PIN was verified during the unlocked wallet session. No network service or backend is required.

Operator lock settings are stored with merchant settings. Inactivity locking is enforced in the browser through pointer, keyboard, and visibility events. Sale locking clears the active operator as part of the same persisted order update where possible so the audit record and lock state cannot drift.

## Safety rules

- Inactive or missing staff are discarded from the on-shift roster during storage reconciliation.
- A member cannot be deactivated while they are current or on shift.
- PIN rate limiting continues to use the existing per-member attempt state.
- Removing the current operator also locks the till.
- No PIN can sign a Stellar transaction or substitute for vault unlock.
