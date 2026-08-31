import {
  type ShieldedNoteRecord,
  type ShieldedActivityRecord,
  type ShieldedCheckpoint,
  type PrivatePendingAction,
  type PrivateRecentRecipient,
} from './types';

export interface PrivateBalanceState {
  isOptedIn: boolean;
  isUnlocked: boolean;
  isSyncing: boolean;
  shieldedAddress: string | null;
  ownerCommitmentHex: string | null;
  notes: ShieldedNoteRecord[];
  activities: ShieldedActivityRecord[];
  checkpoint: ShieldedCheckpoint | null;
  pendingActions: PrivatePendingAction[];
  recentRecipients: PrivateRecentRecipient[];
  error: string | null;
}

export const initialPrivateBalanceState: PrivateBalanceState = {
  isOptedIn: false,
  isUnlocked: false,
  isSyncing: false,
  shieldedAddress: null,
  ownerCommitmentHex: null,
  notes: [],
  activities: [],
  checkpoint: null,
  pendingActions: [],
  recentRecipients: [],
  error: null,
};

export type PrivateBalanceAction =
  | { type: 'SET_OPTED_IN'; optedIn: boolean }
  | { type: 'SET_UNLOCKED'; unlocked: boolean; address?: string; ownerCommitmentHex?: string }
  | { type: 'SET_SYNCING'; syncing: boolean }
  | { type: 'SET_NOTES'; notes: ShieldedNoteRecord[] }
  | { type: 'ADD_NOTE'; note: ShieldedNoteRecord }
  | { type: 'SET_ACTIVITIES'; activities: ShieldedActivityRecord[] }
  | { type: 'ADD_ACTIVITY'; activity: ShieldedActivityRecord }
  | { type: 'SET_CHECKPOINT'; checkpoint: ShieldedCheckpoint }
  | { type: 'SET_PENDING_ACTIONS'; pendingActions: PrivatePendingAction[] }
  | { type: 'SET_RECENT_RECIPIENTS'; recentRecipients: PrivateRecentRecipient[] }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'RESET' };

export function privateBalanceReducer(
  state: PrivateBalanceState,
  action: PrivateBalanceAction
): PrivateBalanceState {
  switch (action.type) {
    case 'SET_OPTED_IN':
      return { ...state, isOptedIn: action.optedIn };
    case 'SET_UNLOCKED':
      return {
        ...state,
        isUnlocked: action.unlocked,
        shieldedAddress: action.address || state.shieldedAddress,
        ownerCommitmentHex: action.ownerCommitmentHex || state.ownerCommitmentHex,
      };
    case 'SET_SYNCING':
      return { ...state, isSyncing: action.syncing };
    case 'SET_NOTES':
      return { ...state, notes: action.notes };
    case 'ADD_NOTE':
      return { ...state, notes: [action.note, ...state.notes] };
    case 'SET_ACTIVITIES':
      return { ...state, activities: action.activities };
    case 'ADD_ACTIVITY':
      return { ...state, activities: [action.activity, ...state.activities] };
    case 'SET_CHECKPOINT':
      return { ...state, checkpoint: action.checkpoint };
    case 'SET_PENDING_ACTIONS':
      return { ...state, pendingActions: action.pendingActions };
    case 'SET_RECENT_RECIPIENTS':
      return { ...state, recentRecipients: action.recentRecipients };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'RESET':
      return initialPrivateBalanceState;
    default:
      return state;
  }
}

export { selectTotalShieldedBalance, selectUnspentNotes } from './selectors';
