import { StrKey } from '@stellar/stellar-sdk';
import { loadExpectedPrivateBalanceCatalogue, loadPrivateBalanceDeployments } from '@/lib/private-balance-assets';
import { IndexedDbEncryptedRecordDriver } from '@/lib/indexed-db';
import { withPrivacySessionRoot } from '@/lib/vault';
import { commitPrivateBalanceState, createEmptyPrivateBalanceState, loadPrivateBalanceState } from '@/features/private-balance/runtime/storage';

/** Isolated encrypted synthetic checkpoints: never valid proofs or live funds. */
export async function seedSyntheticAccountValues(accountId: string, native: string) {
  const { catalogue } = await loadExpectedPrivateBalanceCatalogue();
  const deployments = await loadPrivateBalanceDeployments({ catalogue, network: 'testnet' });
  const pools = new Map<string, typeof deployments>();
  for (const deployment of deployments) pools.set(deployment.poolDeploymentId, [...pools.get(deployment.poolDeploymentId) ?? [], deployment]);
  for (const assets of pools.values()) {
    const { manifest, manifestHash } = assets[0];
    const scope = { accountId, networkId: manifest.networkId, realmId: manifest.realmId,
      poolId: Array.from(StrKey.decodeContract(manifest.poolContractId), byte => byte.toString(16).padStart(2, '0')).join(''),
      deploymentBindingHash: manifest.deploymentBindingHash };
    const state = createEmptyPrivateBalanceState(manifestHash, 1);
    state.account = { setupState: 'ready', syncStatus: 'current', lastVerifiedActionIndex: 0, updatedAt: 2 };
    state.notes = assets.map(({ asset }, index) => ({
      id: (index + 10).toString(16).padStart(2, '0').repeat(32), commitment: (index + 10).toString(16).padStart(2, '0').repeat(32),
      value: asset.kind === 'native' ? native : '70000000', assetIndex: asset.index, assetContractId: asset.contractId,
      diversifier: '00000001', ownerCommitment: '07'.repeat(32), leafIndex: index, actionIndex: 0,
      rho: '08'.repeat(32), memoHex: '', senderFingerprintHex: '', status: 'unspent', createdAt: 1,
    }));
    state.checkpoint = { lastActionIndex: 0, lastRecordHash: '0a'.repeat(32), treeRoot: '0b'.repeat(32),
      treeFrontier: Array.from({ length: 34 }, () => '00'.repeat(32)), deploymentBindingHash: manifest.deploymentBindingHash,
      manifestHash, latestLedger: 100, updatedAt: 2 };
    await withPrivacySessionRoot(accountId, manifest, async (_root, storageKey) => {
      const driver = new IndexedDbEncryptedRecordDriver();
      const current = await loadPrivateBalanceState(scope, storageKey, driver);
      state.revision = current ? current.revision + 1 : 0;
      await commitPrivateBalanceState(scope, storageKey, state, current?.revision ?? null, driver);
    });
  }
}
