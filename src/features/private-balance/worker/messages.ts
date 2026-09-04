import type {
  ActionModel,
  ArchiveRecordModel,
  MerklePathWitness,
  MerkleTree,
} from '@stellarkey/private-balance';
import type { ShieldedActivityRecord, ShieldedNoteRecord } from '../runtime/types';
import type { BuildActionIntent } from './action-builder';

export const PRIVATE_BALANCE_WORKER_MESSAGE_VERSION = 1;

interface WorkerMessage {
  messageVersion: typeof PRIVATE_BALANCE_WORKER_MESSAGE_VERSION;
  id: string;
  sessionId: string;
}

export interface ProofData {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}

export interface PrivateBalanceKeyContext {
  protocolVersion: number;
  networkId: Uint8Array;
  realmId: Uint8Array;
  poolId: Uint8Array;
  accountPublicKey: Uint8Array;
  contextField: Uint8Array;
  deploymentBindingHash: Uint8Array;
  addressPrefix: 'tskpay_' | 'skpay_';
  assets: Array<{ index: number; contractId: string }>;
}

export type WorkerRequest =
  | (WorkerMessage & {
      type: 'INIT_SESSION';
      keyContext: PrivateBalanceKeyContext;
      sessionRoot: ArrayBuffer;
      addressDiversifier?: Uint8Array;
    })
  | (WorkerMessage & {
      type: 'GENERATE_ADDRESS';
    })
  | (WorkerMessage & {
      type: 'DERIVE_ADDRESS';
      diversifier: Uint8Array;
    })
  | (WorkerMessage & {
      type: 'VERIFY_RELAY_FEE';
      actionNonce: Uint8Array;
      outputs: Array<{ commitment: Uint8Array; recipientEnvelope: Uint8Array }>;
      assetIndex: number;
      feeAtomic: string;
      actionDiversifier: Uint8Array;
    })
  | (WorkerMessage & {
      type: 'SCAN_PAGE';
      records: ArchiveRecordModel[];
      expectedPriorRecordHash: Uint8Array;
      initialTree?: MerkleTree;
      existingNotes?: ShieldedNoteRecord[];
      ledgerClosedAt?: Readonly<Record<number, number>>;
    })
  | (WorkerMessage & {
      type: 'BUILD_ACTION';
      reservationId: string;
      intent: BuildActionIntent;
      merklePaths: MerklePathWitness[];
      availableNotes: ShieldedNoteRecord[];
    })
  | (WorkerMessage & {
      type: 'GENERATE_PROOF';
      preparedActionId: string;
      wasmBuffer: ArrayBuffer;
      zkeyBuffer: ArrayBuffer;
      verificationKey: Record<string, unknown>;
    })
  | (WorkerMessage & {
      type: 'CANCEL';
      targetOperationId: string;
    })
  | (WorkerMessage & {
      type: 'LOCK';
    });

export type WorkerResponse =
  | (WorkerMessage & {
      type: 'INIT_OK';
      ownerCommitmentHex: string;
      address: string;
    })
  | (WorkerMessage & {
      type: 'ADDRESS_OK';
      ownerCommitmentHex: string;
      address: string;
    })
  | (WorkerMessage & {
      type: 'ADDRESS_DERIVED';
      ownerCommitmentHex: string;
      address: string;
    })
  | (WorkerMessage & {
      type: 'RELAY_FEE_VERIFIED';
    })
  | (WorkerMessage & {
      type: 'SCAN_OK';
      notes: ShieldedNoteRecord[];
      activities: ShieldedActivityRecord[];
      tree: MerkleTree;
      lastRecordHash: Uint8Array;
      spentNullifierHexes: string[];
      nullifiersByCommitment: Array<[string, string]>;
    })
  | (WorkerMessage & {
      type: 'ACTION_PREPARED';
      reservationId: string;
      preparedActionId: string;
      action: ActionModel;
      actionFieldHex: string;
      reservedNoteIds: string[];
      inputValue: string;
      changeValue: string;
      anchorExpiresAtLedger: number;
    })
  | (WorkerMessage & {
      type: 'PROOF_PROGRESS';
      percentage: 10 | 80 | 95;
    })
  | (WorkerMessage & {
      type: 'PROOF_OK';
      proof: ProofData;
      publicSignals: string[];
      sorobanProofHex: string;
    })
  | (WorkerMessage & {
      type: 'CANCELLED';
      targetOperationId: string;
    })
  | (WorkerMessage & {
      type: 'ERROR';
      error: string;
    });
