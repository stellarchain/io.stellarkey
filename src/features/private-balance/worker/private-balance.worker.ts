import {
  computeContextHash,
  proveAction,
  verifyProofLocally,
  encodePrivateAddress,
  deriveDiversifiedAddressKeys,
  deriveExpandedSpendingKey,
  randomBytes32,
  type ExpandedSpendingKey,
} from '@stellarkey/private-balance';
import type { PrivateBalanceKeyContext, WorkerRequest, WorkerResponse } from './messages';
import { PRIVATE_BALANCE_WORKER_MESSAGE_VERSION } from './messages';
import { redactSensitiveData } from './redaction';
import { scanArchiveRecords } from '../runtime/scanner';
import { preparePrivateAction, type PreparedPrivateAction } from './action-builder';

let currentEsk: ExpandedSpendingKey | null = null;
let currentSessionId: string | null = null;
let currentKeyContext: PrivateBalanceKeyContext | null = null;
let currentAddressDiversifier: Uint8Array | null = null;
let currentPrepared: {
  id: string;
  circuitInputs: PreparedPrivateAction['circuitInputs'];
  publicSignals: string[];
} | null = null;
let activeProofOperationId: string | null = null;
let cancelledProofOperationId: string | null = null;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clearCurrentEsk(): void {
  clearPreparedAction();
  if (currentEsk) {
    currentEsk.ask.fill(0);
    currentEsk.nk.fill(0);
    currentEsk.baseOwnerCommitment.fill(0);
    currentEsk.ownerCommitment.fill(0);
    currentEsk.hpkePrivateKey.fill(0);
    currentEsk.hpkePublicKey.fill(0);
  }
  currentEsk = null;
  currentSessionId = null;
  currentKeyContext = null;
  currentAddressDiversifier?.fill(0);
  currentAddressDiversifier = null;
}

function zeroWitnessValue(value: string | string[] | string[][]): void {
  if (!Array.isArray(value)) return;
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (Array.isArray(item)) zeroWitnessValue(item);
    else value[index] = '0';
  }
}

function zeroCircuitInputs(inputs: PreparedPrivateAction['circuitInputs']): void {
  for (const key of Object.keys(inputs)) {
    const value = inputs[key];
    if (Array.isArray(value)) zeroWitnessValue(value);
    else inputs[key] = '0';
  }
}

function clearPreparedAction(): void {
  if (currentPrepared) zeroCircuitInputs(currentPrepared.circuitInputs);
  currentPrepared = null;
}

function activeSession(req: WorkerRequest): {
  esk: ExpandedSpendingKey;
  keyContext: PrivateBalanceKeyContext;
} {
  if (!currentEsk || !currentKeyContext || currentSessionId !== req.sessionId) {
    throw new Error('Private Balance worker session is stale or not initialized');
  }
  return { esk: currentEsk, keyContext: currentKeyContext };
}

async function selectAddressIdentity(
  esk: ExpandedSpendingKey,
  keyContext: PrivateBalanceKeyContext,
  diversifier: Uint8Array,
): Promise<{ ownerCommitmentHex: string; address: string }> {
  if (diversifier.length !== 4) throw new Error('Private address diversifier must be 4 bytes');
  const identity = await deriveDiversifiedAddressKeys(
    esk.baseOwnerCommitment,
    esk.hpkePrivateKey,
    diversifier,
  );
  try {
    esk.ownerCommitment.set(identity.ownerCommitment);
    esk.hpkePublicKey.set(identity.hpkePublicKey);
    currentAddressDiversifier?.fill(0);
    currentAddressDiversifier = identity.diversifier.slice();
    return {
      ownerCommitmentHex: toHex(identity.ownerCommitment),
      address: encodePrivateAddress({
        diversifier: identity.diversifier,
        ownerCommitment: identity.ownerCommitment,
        hpkePublicKey: identity.hpkePublicKey,
      }, keyContext.addressPrefix),
    };
  } finally {
    identity.hpkePrivateKey.fill(0);
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.messageVersion !== PRIVATE_BALANCE_WORKER_MESSAGE_VERSION) {
      throw new Error('Unsupported Private Balance worker message version');
    }
    switch (req.type) {
      case 'INIT_SESSION': {
        const sessionRoot = new Uint8Array(req.sessionRoot);
        try {
          if (sessionRoot.length !== 64) throw new Error('Privacy session root must be 64 bytes');
          clearCurrentEsk();
          const context = req.keyContext;
          currentEsk = await deriveExpandedSpendingKey(
            sessionRoot,
            context.protocolVersion,
            context.networkId,
            context.realmId,
            context.poolId,
            context.accountPublicKey,
            context.contextField,
          );
          currentSessionId = req.sessionId;
          currentKeyContext = context;

          const identity = await selectAddressIdentity(
            currentEsk,
            context,
            req.addressDiversifier ?? new Uint8Array(4),
          );

          const resp: WorkerResponse = {
            messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
            id: req.id,
            sessionId: req.sessionId,
            type: 'INIT_OK',
            ownerCommitmentHex: identity.ownerCommitmentHex,
            address: identity.address,
          };
          self.postMessage(resp);
        } finally {
          sessionRoot.fill(0);
        }
        break;
      }

      case 'GENERATE_ADDRESS': {
        const { esk, keyContext } = activeSession(req);
        let entropy: Uint8Array | null = null;
        let diversifier: Uint8Array | null = null;
        try {
          do {
            entropy?.fill(0);
            diversifier?.fill(0);
            entropy = randomBytes32();
            diversifier = entropy.slice(0, 4);
          } while (
            currentAddressDiversifier &&
            diversifier.every((byte, index) => byte === currentAddressDiversifier?.[index])
          );
          const identity = await selectAddressIdentity(esk, keyContext, diversifier);
          self.postMessage({
            messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
            id: req.id,
            sessionId: req.sessionId,
            type: 'ADDRESS_OK',
            ownerCommitmentHex: identity.ownerCommitmentHex,
            address: identity.address,
          } satisfies WorkerResponse);
        } finally {
          entropy?.fill(0);
          diversifier?.fill(0);
        }
        break;
      }

      case 'SCAN_PAGE': {
        const { esk, keyContext } = activeSession(req);
        const result = await scanArchiveRecords({
          records: req.records,
          viewingKey: esk,
          context: {
            protocolVersion: keyContext.protocolVersion,
            networkId: keyContext.networkId,
            realmId: keyContext.realmId,
            poolId: keyContext.poolId,
            contextHash: computeContextHash(
              keyContext.protocolVersion,
              keyContext.networkId,
              keyContext.realmId,
              keyContext.poolId,
            ),
            contextField: keyContext.contextField,
            accountAddress: { kind: 0, payload: keyContext.accountPublicKey },
          },
          expectedPriorRecordHash: req.expectedPriorRecordHash,
          initialTree: req.initialTree,
          existingNotes: req.existingNotes,
          ledgerClosedAt: req.ledgerClosedAt,
        });

        const resp: WorkerResponse = {
          messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
          id: req.id,
          sessionId: req.sessionId,
          type: 'SCAN_OK',
          notes: result.notes,
          activities: result.activities,
          tree: result.tree,
          lastRecordHash: result.lastRecordHash,
          spentNullifierHexes: result.spentNullifierHexes,
          nullifiersByCommitment: [...result.nullifiersByCommitment],
        };
        self.postMessage(resp);
        break;
      }

      case 'BUILD_ACTION': {
        const { esk, keyContext } = activeSession(req);
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(req.reservationId)) {
          throw new Error('Private Balance build reservation ID is invalid');
        }
        clearPreparedAction();
        const prepared = await preparePrivateAction({
          esk,
          keyContext,
          availableNotes: req.availableNotes,
          commitments: req.commitments,
          intent: req.intent,
        });
        const preparedActionId = toHex(randomBytes32());
        currentPrepared = {
          id: preparedActionId,
          circuitInputs: prepared.circuitInputs,
          publicSignals: prepared.publicSignals,
        };
        const resp: WorkerResponse = {
          messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
          id: req.id,
          sessionId: req.sessionId,
          type: 'ACTION_PREPARED',
          reservationId: req.reservationId,
          preparedActionId,
          action: prepared.action,
          actionFieldHex: toHex(prepared.actionField),
          actionBindingHex: toHex(prepared.actionBinding),
          reservedNoteIds: prepared.reservedNoteIds,
          inputValue: prepared.inputValue,
          changeValue: prepared.changeValue,
          anchorExpiresAtLedger: prepared.anchorExpiresAtLedger,
        };
        self.postMessage(resp);
        break;
      }

      case 'GENERATE_PROOF': {
        activeSession(req);
        const prepared = currentPrepared;
        if (!prepared || prepared.id !== req.preparedActionId) {
          throw new Error('Prepared Private Balance action is stale or unavailable');
        }
        currentPrepared = null;
        const wasmBytes = new Uint8Array(req.wasmBuffer);
        const zkeyBytes = new Uint8Array(req.zkeyBuffer);
        activeProofOperationId = req.id;
        try {
          self.postMessage({
            messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
            id: req.id,
            sessionId: req.sessionId,
            type: 'PROOF_PROGRESS',
            percentage: 10,
          } satisfies WorkerResponse);
          const proofRes = await proveAction(prepared.circuitInputs, wasmBytes, zkeyBytes);
          if (cancelledProofOperationId === req.id) break;
          self.postMessage({
            messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
            id: req.id,
            sessionId: req.sessionId,
            type: 'PROOF_PROGRESS',
            percentage: 80,
          } satisfies WorkerResponse);
          if (
            proofRes.publicSignals.length !== prepared.publicSignals.length ||
            proofRes.publicSignals.some((signal, index) => signal !== prepared.publicSignals[index])
          ) {
            throw new Error('Generated Private Balance proof has unexpected public signals');
          }
          const verified = await verifyProofLocally(
            req.verificationKey,
            proofRes.publicSignals,
            proofRes.proof,
          );
          if (!verified) throw new Error('Generated Private Balance proof failed local verification');
          self.postMessage({
            messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
            id: req.id,
            sessionId: req.sessionId,
            type: 'PROOF_PROGRESS',
            percentage: 95,
          } satisfies WorkerResponse);

          const resp: WorkerResponse = {
            messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
            id: req.id,
            sessionId: req.sessionId,
            type: 'PROOF_OK',
            proof: proofRes.proof,
            publicSignals: proofRes.publicSignals,
            sorobanProofHex: toHex(proofRes.sorobanProofBytes),
          };
          self.postMessage(resp);
        } finally {
          zeroCircuitInputs(prepared.circuitInputs);
          wasmBytes.fill(0);
          zkeyBytes.fill(0);
          activeProofOperationId = null;
          cancelledProofOperationId = null;
        }
        break;
      }

      case 'CANCEL': {
        if (activeProofOperationId === req.targetOperationId) {
          cancelledProofOperationId = req.targetOperationId;
        }
        if (currentPrepared) clearPreparedAction();
        self.postMessage({
          messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
          id: req.id,
          sessionId: req.sessionId,
          type: 'CANCELLED',
          targetOperationId: req.targetOperationId,
        } satisfies WorkerResponse);
        break;
      }

      case 'LOCK': {
        if (currentSessionId === req.sessionId) clearCurrentEsk();
        activeProofOperationId = null;
        cancelledProofOperationId = null;
        break;
      }
    }
  } catch (err: unknown) {
    // A failed GENERATE_PROOF already zeroes its witness and artifact buffers
    // in its own finally block; only a failed INIT_SESSION invalidates the
    // session key needed for later scans.
    if (req.type === 'INIT_SESSION') clearCurrentEsk();
    const errorMsg = redactSensitiveData((err as Error)?.message || 'Worker error');
    const resp: WorkerResponse = {
      messageVersion: PRIVATE_BALANCE_WORKER_MESSAGE_VERSION,
      id: req.id,
      sessionId: req.sessionId,
      type: 'ERROR',
      error: errorMsg,
    };
    self.postMessage(resp);
  }
};
