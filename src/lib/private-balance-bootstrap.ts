import type { AccountMeta } from './types';

export interface PrivateBalanceStorageScope {
  networkId: string;
  realmId: string;
  poolId: string;
  accountId: string;
  deploymentBindingHash: string;
}

interface PrivateBalanceStateProbe {
  read(key: string): Promise<string | null>;
}

interface PrivateBalanceRuntimeMountInput {
  accountReady: boolean;
  deploymentReady: boolean;
  requested: boolean;
  encryptedStateExists: boolean;
}

interface PrivateBalanceDeploymentCandidate {
  id: string;
  asset: { kind: 'native' | 'stellar' };
  encryptedStateExists: boolean;
}

interface PrivateBalancePoolCandidate {
  poolDeploymentId: string;
  encryptedStateExists: boolean;
}

interface PrivateBalanceConfiguredCandidate {
  encryptedStateExists: boolean;
}

export type PrivateBalanceAccountSupport =
  | { ready: true }
  | { ready: false; reason: string };

function hex32(value: string, name: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${name} must be 32-byte lowercase hex`);
  }
  return value;
}

function opaqueAccountId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error('Private Balance account ID is invalid.');
  }
  return value;
}

export function privateBalanceSensitivePrefix(
  scope: PrivateBalanceStorageScope,
): string {
  return [
    'private:sensitive:v1',
    hex32(scope.networkId, 'Private Balance network ID'),
    hex32(scope.realmId, 'Private Balance realm ID'),
    hex32(scope.poolId, 'Private Balance pool ID'),
    opaqueAccountId(scope.accountId),
    hex32(scope.deploymentBindingHash, 'Private Balance deployment binding hash'),
    '',
  ].join(':');
}

export function privateBalanceStateRecordKey(
  scope: PrivateBalanceStorageScope,
): string {
  return `${privateBalanceSensitivePrefix(scope)}state`;
}

export async function hasEncryptedPrivateBalanceState(
  scope: PrivateBalanceStorageScope,
  driver: PrivateBalanceStateProbe,
): Promise<boolean> {
  return (await driver.read(privateBalanceStateRecordKey(scope))) !== null;
}

export function privateBalanceAccountSupport(
  walletPhase: string,
  account: Pick<AccountMeta, 'id' | 'publicKey' | 'watchOnly' | 'hardware'> | null,
): PrivateBalanceAccountSupport {
  if (walletPhase !== 'unlocked') {
    return { ready: false, reason: 'Unlock StellarKey to use Private Balance.' };
  }
  if (!account) {
    return { ready: false, reason: 'Choose a software account to use Private Balance.' };
  }
  if (account.watchOnly) {
    return { ready: false, reason: 'Private Balance is unavailable for watch-only accounts.' };
  }
  if (account.hardware) {
    return { ready: false, reason: 'Private Balance does not yet support hardware-backed accounts.' };
  }
  return { ready: true };
}

export function shouldMountPrivateBalanceRuntime({
  accountReady,
  deploymentReady,
  requested,
  encryptedStateExists,
}: PrivateBalanceRuntimeMountInput): boolean {
  return accountReady && deploymentReady && (requested || encryptedStateExists);
}

/** Private Payments is enabled for the shared pool when any asset sees its durable state. */
export function privateBalancePoolConfigured(
  deployments: readonly PrivateBalanceConfiguredCandidate[],
): boolean {
  return deployments.some(deployment => deployment.encryptedStateExists);
}

export function selectPrivateBalanceDeploymentId(
  deployments: readonly PrivateBalanceDeploymentCandidate[],
  selectedDeploymentId: string | null,
): string | null {
  if (selectedDeploymentId && deployments.some(item => item.id === selectedDeploymentId)) {
    return selectedDeploymentId;
  }
  return deployments.find(item => item.encryptedStateExists)?.id
    ?? deployments.find(item => item.asset.kind === 'native')?.id
    ?? deployments[0]?.id
    ?? null;
}

export function updatePrivateBalancePoolStorageState<T extends PrivateBalancePoolCandidate>(
  deployments: T[],
  poolDeploymentId: string,
  encryptedStateExists: boolean,
): T[] {
  let changed = false;
  const updated = deployments.map(deployment => {
    if (
      deployment.poolDeploymentId !== poolDeploymentId ||
      deployment.encryptedStateExists === encryptedStateExists
    ) {
      return deployment;
    }
    changed = true;
    return { ...deployment, encryptedStateExists };
  });
  return changed ? updated : deployments;
}
