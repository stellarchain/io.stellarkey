import { StrKey } from '@stellar/stellar-sdk';
import type { AccountMeta } from '@/lib/types';
import type { LoadedPrivateBalanceDeployment } from '@/lib/private-balance-assets';
import { hasEncryptedPrivateBalanceState, privateBalanceAccountSupport } from '@/lib/private-balance-bootstrap';
import { privateBalanceAvailability } from '@/lib/private-balance-manifest';
import { ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE } from '@/lib/private-balance-expected-manifest';
import { IndexedDbEncryptedRecordDriver } from '@/lib/indexed-db';
import { withPrivacySessionRoot } from '@/lib/vault';
import { buildPrivatePortfolioEntries, type PrivatePortfolioBalance } from './portfolio';

const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

/** Read authenticated local checkpoints only; no workers, RPC, scans, signing or writes. */
export async function loadPrivateAccountPortfolio(
  account: AccountMeta,
  network: 'testnet' | 'mainnet',
  deployments: readonly LoadedPrivateBalanceDeployment[],
  assertCurrent: () => void,
): Promise<PrivatePortfolioBalance[]> {
  assertCurrent();
  if (!privateBalanceAccountSupport('unlocked', account).ready) return [];
  const driver = new IndexedDbEncryptedRecordDriver();
  const durableByPool = new Map<string, ReturnType<typeof import('./storage').loadPrivateBalanceState>>();
  const candidates = [];
  for (const deployment of deployments) {
    assertCurrent();
    const manifest = deployment.manifest;
    if (!privateBalanceAvailability(manifest, network, {
      allowDevelopmentFixture: ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE,
    }).ready) continue;
    let durable = durableByPool.get(deployment.poolDeploymentId);
    if (!durable) {
      const poolId = new Uint8Array(StrKey.decodeContract(manifest.poolContractId));
      const scope = { networkId: manifest.networkId, realmId: manifest.realmId, poolId: hex(poolId),
        accountId: account.id, deploymentBindingHash: manifest.deploymentBindingHash };
      durable = (async () => {
        const exists = await hasEncryptedPrivateBalanceState(scope, driver);
        assertCurrent();
        if (!exists) return null;
        const { loadPrivateBalanceState } = await import('./storage');
        assertCurrent();
        return withPrivacySessionRoot(account.id, {
          protocolVersion: manifest.protocolVersion,
          networkId: manifest.networkId, realmId: manifest.realmId,
          poolContractId: manifest.poolContractId,
          deploymentBindingHash: manifest.deploymentBindingHash,
        }, async (_root, storageKey) => {
          assertCurrent();
          const state = await loadPrivateBalanceState(scope, storageKey, driver);
          assertCurrent();
          return state;
        });
      })();
      durableByPool.set(deployment.poolDeploymentId, durable);
    }
    candidates.push({ deploymentId: deployment.id, asset: deployment.asset, durable: await durable });
  }
  assertCurrent();
  return buildPrivatePortfolioEntries(candidates).map(({ asset, verifiedBalanceAtomicUnits }) => ({ asset, verifiedBalanceAtomicUnits }));
}
