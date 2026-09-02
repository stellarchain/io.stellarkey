import type { ArchiveHeadState } from './archive-client';
import { TREE_FRONTIER_SIZE } from '@stellarkey/private-balance';

const DEFAULT_MAXIMUM_HEAD_ATTEMPTS = 3;
const HEX_32 = /^[0-9a-f]{64}$/;

export interface PrivateRpcLedgerIdentity {
  sequence: number;
  hash: string;
}

export interface PrivateRpcDeploymentCheckpoint {
  ledger: number;
  hash: string;
}

export interface PrivateRpcCheckpointReader {
  readNetworkPassphrase(): Promise<string>;
  readLatestLedgerSequence(): Promise<number>;
  readLedgerIdentity(sequence: number): Promise<PrivateRpcLedgerIdentity>;
  readHead(): Promise<ArchiveHeadState>;
}

export interface CorroboratedPrivateRpcCheckpoint {
  head: ArchiveHeadState;
  commonLedger: Readonly<PrivateRpcLedgerIdentity>;
  deploymentCheckpoint: Readonly<PrivateRpcLedgerIdentity>;
  attempts: number;
}

export class PrivateRpcViewsDisagreeError extends Error {
  constructor(message = 'Private Payments RPC views disagree.') {
    super(message);
    this.name = 'PrivateRpcViewsDisagreeError';
  }
}

export class PrivateRpcWitnessUnavailableError extends Error {
  constructor() {
    super('The independent Private Payments witness RPC is unavailable.');
    this.name = 'PrivateRpcWitnessUnavailableError';
  }
}

function abortError(): Error {
  return new DOMException('Private Payments RPC checkpoint verification cancelled.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function u32(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffff_ffff) {
    throw new PrivateRpcViewsDisagreeError(`${name} is invalid.`);
  }
  return value as number;
}

function hash(value: unknown, name: string): string {
  if (typeof value !== 'string' || !HEX_32.test(value)) {
    throw new PrivateRpcViewsDisagreeError(`${name} is invalid.`);
  }
  return value;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PrivateRpcViewsDisagreeError(`${name} is invalid.`);
  }
  return value;
}

function bytes32(value: unknown, name: string): string {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new PrivateRpcViewsDisagreeError(`${name} is invalid.`);
  }
  return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
}

function ledgerIdentity(
  value: PrivateRpcLedgerIdentity,
  expectedSequence: number,
  name: string,
): Readonly<PrivateRpcLedgerIdentity> {
  const sequence = u32(value?.sequence, `${name} sequence`);
  if (sequence !== expectedSequence) {
    throw new PrivateRpcViewsDisagreeError(`${name} sequence does not match the request.`);
  }
  return Object.freeze({ sequence, hash: hash(value?.hash, `${name} hash`) });
}

function headFingerprint(head: ArchiveHeadState, name: string): string {
  u32(head?.latestLedger, `${name} latest ledger`);
  const config = head?.config;
  const meta = head?.meta;
  const tree = head?.tree;
  if (
    !config ||
    !meta ||
    !tree ||
    !Array.isArray(tree.frontier) ||
    tree.frontier.length !== TREE_FRONTIER_SIZE
  ) {
    throw new PrivateRpcViewsDisagreeError(`${name} contract head is invalid.`);
  }
  const actionCount = u32(meta.actionCount, `${name} action count`);
  if (!Number.isSafeInteger(tree.nextIndex) || tree.nextIndex !== actionCount * 2) {
    throw new PrivateRpcViewsDisagreeError(`${name} contract head is inconsistent.`);
  }
  return JSON.stringify({
    config: {
      protocolVersion: u32(config.protocolVersion, `${name} protocol version`),
      networkId: bytes32(config.networkId, `${name} network ID`),
      realmId: bytes32(config.realmId, `${name} realm ID`),
      guardian: text(config.guardian, `${name} guardian`),
      poseidon2ParameterHash: bytes32(
        config.poseidon2ParameterHash,
        `${name} Poseidon parameter hash`,
      ),
      circuitHash: bytes32(config.circuitHash, `${name} circuit hash`),
      verificationKeyHash: bytes32(
        config.verificationKeyHash,
        `${name} verification key hash`,
      ),
      treeDepth: u32(config.treeDepth, `${name} tree depth`),
      rootWindowLedgers: u32(config.rootWindowLedgers, `${name} root window`),
      deploymentBindingHash: bytes32(
        config.deploymentBindingHash,
        `${name} deployment binding hash`,
      ),
      contextHash: bytes32(config.contextHash, `${name} context hash`),
      contextField: bytes32(config.contextField, `${name} context field`),
    },
    meta: {
      actionCount,
      transcriptHead: bytes32(meta.transcriptHead, `${name} transcript head`),
    },
    tree: {
      nextIndex: tree.nextIndex,
      frontier: tree.frontier.map((node, index) =>
        bytes32(node, `${name} frontier ${index}`)),
      currentRoot: bytes32(tree.currentRoot, `${name} current root`),
    },
  });
}

async function witnessCall<T>(
  signal: AbortSignal | undefined,
  call: () => Promise<T>,
): Promise<T> {
  throwIfAborted(signal);
  try {
    const value = await call();
    throwIfAborted(signal);
    return value;
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      throw abortError();
    }
    if (error instanceof PrivateRpcViewsDisagreeError) throw error;
    throw new PrivateRpcWitnessUnavailableError();
  }
}

export async function corroboratePrivateRpcCheckpoint(input: {
  primary: PrivateRpcCheckpointReader;
  witness: PrivateRpcCheckpointReader;
  expectedNetworkPassphrase: string;
  deploymentCheckpoint: PrivateRpcDeploymentCheckpoint;
  maximumHeadAttempts?: number;
  signal?: AbortSignal;
}): Promise<CorroboratedPrivateRpcCheckpoint> {
  const maximumHeadAttempts = input.maximumHeadAttempts ?? DEFAULT_MAXIMUM_HEAD_ATTEMPTS;
  if (!Number.isInteger(maximumHeadAttempts) || maximumHeadAttempts < 1 || maximumHeadAttempts > 8) {
    throw new Error('Private Payments RPC head-attempt limit is invalid.');
  }
  const deploymentSequence = u32(
    input.deploymentCheckpoint.ledger,
    'Manifest deployment checkpoint ledger',
  );
  const expectedDeploymentHash = hash(
    input.deploymentCheckpoint.hash,
    'Manifest deployment checkpoint hash',
  );
  throwIfAborted(input.signal);
  const [primaryPassphrase, witnessPassphrase] = await Promise.all([
    input.primary.readNetworkPassphrase(),
    witnessCall(input.signal, () => input.witness.readNetworkPassphrase()),
  ]);
  throwIfAborted(input.signal);
  if (
    primaryPassphrase !== input.expectedNetworkPassphrase ||
    witnessPassphrase !== input.expectedNetworkPassphrase
  ) {
    throw new PrivateRpcViewsDisagreeError('Private Payments RPC network identities disagree.');
  }

  const [primaryDeployment, witnessDeployment] = await Promise.all([
    input.primary.readLedgerIdentity(deploymentSequence).then(
      value => ({ retained: true as const, value }),
      () => ({ retained: false as const }),
    ),
    witnessCall(
      input.signal,
      () => input.witness.readLedgerIdentity(deploymentSequence),
    ),
  ]);
  const witnessDeploymentIdentity = ledgerIdentity(
    witnessDeployment,
    deploymentSequence,
    'Witness deployment checkpoint',
  );
  if (
    witnessDeploymentIdentity.hash !== expectedDeploymentHash
  ) {
    throw new PrivateRpcViewsDisagreeError(
      'Private Payments RPC deployment checkpoint does not match the manifest.',
    );
  }
  if (primaryDeployment.retained) {
    const primaryDeploymentIdentity = ledgerIdentity(
      primaryDeployment.value,
      deploymentSequence,
      'Primary deployment checkpoint',
    );
    if (primaryDeploymentIdentity.hash !== expectedDeploymentHash) {
      throw new PrivateRpcViewsDisagreeError(
        'Private Payments RPC deployment checkpoint does not match the manifest.',
      );
    }
  }

  for (let attempt = 1; attempt <= maximumHeadAttempts; attempt += 1) {
    throwIfAborted(input.signal);
    const [primaryLatest, witnessLatest] = await Promise.all([
      input.primary.readLatestLedgerSequence(),
      witnessCall(input.signal, () => input.witness.readLatestLedgerSequence()),
    ]);
    const commonSequence = Math.min(
      u32(primaryLatest, 'Primary latest ledger'),
      u32(witnessLatest, 'Witness latest ledger'),
    );
    if (commonSequence < deploymentSequence) {
      throw new PrivateRpcViewsDisagreeError(
        'A Private Payments RPC is behind the deployment checkpoint.',
      );
    }
    const [primaryCommon, witnessCommon, primaryHead, witnessHead] = await Promise.all([
      input.primary.readLedgerIdentity(commonSequence),
      witnessCall(input.signal, () => input.witness.readLedgerIdentity(commonSequence)),
      input.primary.readHead(),
      witnessCall(input.signal, () => input.witness.readHead()),
    ]);
    throwIfAborted(input.signal);
    const primaryCommonIdentity = ledgerIdentity(
      primaryCommon,
      commonSequence,
      'Primary overlapping ledger',
    );
    const witnessCommonIdentity = ledgerIdentity(
      witnessCommon,
      commonSequence,
      'Witness overlapping ledger',
    );
    if (primaryCommonIdentity.hash !== witnessCommonIdentity.hash) {
      throw new PrivateRpcViewsDisagreeError(
        'Private Payments RPC views disagree on an overlapping ledger hash.',
      );
    }
    if (
      primaryHead.latestLedger < commonSequence ||
      witnessHead.latestLedger < commonSequence
    ) {
      throw new PrivateRpcViewsDisagreeError(
        'Private Payments RPC contract head predates the overlapping ledger.',
      );
    }
    if (
      headFingerprint(primaryHead, 'Primary') ===
      headFingerprint(witnessHead, 'Witness')
    ) {
      return Object.freeze({
        head: primaryHead,
        commonLedger: primaryCommonIdentity,
        deploymentCheckpoint: Object.freeze({
          sequence: deploymentSequence,
          hash: expectedDeploymentHash,
        }),
        attempts: attempt,
      });
    }
  }
  throw new PrivateRpcViewsDisagreeError(
    'Private Payments RPC contract heads did not agree within the retry limit.',
  );
}
