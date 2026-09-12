'use client';

// Non-usable synthetic vault. The actual wallet/provider, worker thread,
// recovery card, signing API and scanner run; only proof/transport are doubles.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Asset, FeeBumpTransaction, Keypair } from '@stellar/stellar-sdk';
import { Button } from '@/components/ui';
import { SigningPasswordPrompt } from '@/components/SigningPasswordPrompt';
import { ReceiveModal } from '@/components/ReceiveModal';
import { useWallet } from '@/hooks/useWallet';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeControlProvider, usePrivateBalanceRuntime, usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateBalanceProvider } from '@/features/private-balance/runtime/provider';
import { PrivateBalanceCard } from '@/features/private-balance/components/PrivateBalanceCard';
import { IndexedDbEncryptedRecordDriver } from '@/lib/indexed-db';
import { lockVault, unlockVault, withPrivacySessionRoot } from '@/lib/vault';
import type { AccountMeta } from '@/lib/types';
import type { PrivateBalanceManifest } from '@/lib/private-balance-manifest';
import { createPrivateRecoveryScenario } from './private-recovery-scenario';
import development from '../../protocol/private-balance/manifests/development.json';

type Scenario = Awaited<ReturnType<typeof createPrivateRecoveryScenario>>;
const asset = { ...development.assets[0], kind: 'native' as const, status: 'active' as const };
const deployment = { ...initialPrivateBalanceRuntimeData.deployment };
const password = 'synthetic recovery correct horse battery staple';

function Controls({ scenario, sponsoredHash, fixtureAsset }: { scenario: Scenario; sponsoredHash: string | null; fixtureAsset: typeof asset }) {
  const runtime = usePrivateBalanceRuntimeData();
  const { registerAvailableAssets } = usePrivateBalanceRuntime();
  const [receiveOpen, setReceiveOpen] = useState(false);
  useEffect(() => { registerAvailableAssets([{ deploymentId: 'synthetic-recovery-deployment', asset: fixtureAsset, encryptedStateExists: true }], 'synthetic-recovery-deployment'); }, [fixtureAsset, registerAvailableAssets]);
  const [result, setResult] = useState('idle');
  return <>
    <p data-testid="recovery-provider-phase">{runtime.phase}</p>
    <p data-testid="recovery-provider-balance">{runtime.verifiedBalanceStroops}</p>
    <p data-testid="recovery-provider-outcome">{runtime.spendRecovery?.outcome ?? 'none'}</p>
    <p data-testid="recovery-provider-pending">{runtime.pendingActions.length}</p>
    <p data-testid="recovery-provider-result">{result}</p>
    <p data-testid="recovery-provider-shared">{scenario.shared}</p>
    <p data-testid="recovery-provider-submissions">{scenario.submissions}</p>
    <p data-testid="recovery-provider-worker-crashes">{scenario.workerCrashes}</p>
    <p data-testid="recovery-provider-outer-tracked">{String(!!sponsoredHash && runtime.pendingActions.some(action => action.transactionHash === sponsoredHash && action.innerTransactionHash !== sponsoredHash))}</p>
    <Button onClick={() => setReceiveOpen(true)}>Open real provider receive</Button>
    <ReceiveModal open={receiveOpen} onClose={() => setReceiveOpen(false)} initialMode="private" />
    <Button onClick={() => { void runtime.refreshSync().catch(() => setResult('sync-failed')); }}>Refresh real recovery provider</Button>
    <Button onClick={() => { void (async () => {
      await scenario.confirm(true, false); await runtime.refreshSync(); setResult('canonical-delivered');
    })().catch(() => setResult('delivery-failed')); }}>Deliver real provider recovery record</Button>
    <Button onClick={() => { void (async () => {
      await scenario.confirm(false, false); await runtime.refreshSync(); setResult('canonical-delivered');
    })().catch(() => setResult('delivery-failed')); }}>Deliver real provider original record</Button>
    <PrivateBalanceCard privacyMode showAssetSelector={false} />
  </>;
}

export function PrivateRecoveryProviderFixture() {
  const wallet = useWallet();
  const [account, setAccount] = useState<AccountMeta | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const fixtureAsset = useMemo(() => scenario ? { ...asset, contractId: scenario.manifest.assets[0].contractId } : asset, [scenario]);
  const [stage, setStage] = useState('idle');
  const [authority, setAuthority] = useState('unchanged');
  const [signs, setSigns] = useState(0);
  const [retired, setRetired] = useState(false);
  const [mode, setMode] = useState('held-recovery');
  const [feeBinding, setFeeBinding] = useState('unchecked');
  const [sponsoredHash, setSponsoredHash] = useState<string | null>(null);
  const selectedPayerId = useRef<string | null>(null);
  const insufficientFeeBalance = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  const receiveSyncBlocked = useRef(true);
  const resourceFeeExceeded = useRef(false);
  const [rotationState, setRotationState] = useState('idle');
  const finishRotation = useRef<(() => void) | null>(null);
  const refreshedLedger = useRef(false);
  const { refresh } = wallet;
  useEffect(() => {
    // Account creation predates the isolated Horizon transport. Read it once
    // after the original account and the transport are both installed.
    if (!scenario || !mode.startsWith('fee-payer') || refreshedLedger.current) return;
    refreshedLedger.current = true;
    void refresh();
  }, [mode, refresh, scenario]);
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    const original = Keypair.prototype.sign;
    Keypair.prototype.sign = function (...args) { setSigns(value => value + 1); return original.apply(this, args); };
    return () => { Keypair.prototype.sign = original; };
  }, []);
  return <main data-app-surface className="min-h-screen space-y-4 p-6">
    <h1>Synthetic real-provider recovery</h1>
    <label htmlFor="synthetic-provider-mode">Synthetic provider scenario</label>
    <select id="synthetic-provider-mode" value={mode} disabled={stage !== 'idle'} onChange={event => setMode(event.target.value)}>
      <option value="held-recovery">Held recovery</option>
      <option value="deposit-worker-failure">Deposit worker failure</option>
      <option value="deposit-pending-worker-restart">Deposit pending with worker restart</option>
      <option value="deposit-uncertain-worker-restart">Deposit uncertain with worker restart</option>
      <option value="deposit-fee-limit">Deposit fee limit</option>
      <option value="receive-stopped">Receive stopped</option>
      <option value="fee-payer-deposit">Fee payer deposit</option>
      <option value="fee-payer-recovery">Fee payer recovery</option>
    </select>
    <Button disabled={stage !== 'idle'} onClick={() => { setStage('preparing'); let boundary = 'vault'; void (async () => {
      const created = await wallet.createWallet(password, { secret: Keypair.random().secret(), requirePasswordForSigning: true });
      let payerPublicKey: string | null = null;
      if (mode.startsWith('fee-payer')) {
        wallet.renameAccount(created.account.id, 'Synthetic Owner');
        const payer = await wallet.addAccount({ secret: Keypair.random().secret(), label: 'Synthetic Treasury' });
        selectedPayerId.current = payer.id; payerPublicKey = payer.publicKey;
        await wallet.addAccount({ secret: Keypair.random().secret(), label: 'Synthetic Reserve' });
        await wallet.addWatchOnly(Keypair.random().publicKey(), 'Synthetic Watch');
        await wallet.addHardwareAccount({ publicKey: Keypair.random().publicKey(), device: 'trezor', path: "m/44'/148'/0'", label: 'Synthetic Hardware' });
        wallet.selectAccount(created.account.id);
      }
      wallet.completeSetup();
      boundary = 'scenario';
      const scenarioManifest = structuredClone(development) as PrivateBalanceManifest;
      // This fixture exercises public native-balance matching as well as the
      // synthetic private protocol; the development registry uses a fake SAC.
      if (mode.startsWith('fee-payer')) scenarioManifest.assets[0].contractId = Asset.native().contractId(scenarioManifest.networkPassphrase);
      const prepared = await withPrivacySessionRoot(created.account.id, scenarioManifest, async (root, storageKey) =>
        createPrivateRecoveryScenario(scenarioManifest, new IndexedDbEncryptedRecordDriver(), {
          bob: { accountId: created.account.id, publicKey: created.account.publicKey, root, storageKey },
        }));
      boundary = 'hold';
      if (mode === 'held-recovery' || mode === 'fee-payer-recovery') {
        try { await prepared.prepare('rpc-reject'); } catch (error) {
          if (!(error instanceof Error) || error.name !== 'PrivateProofExposedError') throw error;
        }
      }
      boundary = 'transport';
      cleanup.current = prepared.installProviderTransport({
        nativeBalance: mode.startsWith('fee-payer') ? () => insufficientFeeBalance.current ? '3.0000000' : '1000.0000000' : undefined,
        onSubmit: mode.startsWith('fee-payer') ? transaction => {
          const valid = transaction instanceof FeeBumpTransaction && transaction.feeSource === payerPublicKey &&
            transaction.innerTransaction.source === created.account.publicKey &&
            transaction.signatures.length === 1 && transaction.innerTransaction.signatures.length === 1 &&
            BigInt(transaction.fee) === BigInt(transaction.innerTransaction.fee) + 100n;
          setFeeBinding(valid ? 'matched' : 'mismatch');
          if (transaction instanceof FeeBumpTransaction) setSponsoredHash(Array.from(transaction.hash(), byte => byte.toString(16).padStart(2, '0')).join(''));
        } : undefined,
        crashWorkerAt: mode === 'deposit-worker-failure' ? 'build' : mode.includes('worker-restart') ? 'submission' : undefined,
        uncertainSubmission: mode === 'deposit-uncertain-worker-restart',
        simulationResourceFee: () => mode === 'deposit-fee-limit' && resourceFeeExceeded.current ? '50514133' : '500',
        receiveSyncBlocked: () => mode === 'receive-stopped' && receiveSyncBlocked.current,
        beforeAddressRotation: async () => {
          if (mode !== 'receive-stopped') return;
          setRotationState('waiting');
          await new Promise<void>(resolve => { finishRotation.current = resolve; });
          setRotationState('released');
        },
      });
      wallet.completeSetup(); setAccount(created.account); setScenario(prepared); setSigns(0); setStage('ready');
    })().catch(() => setStage(`failed-${boundary}`)); }}>Prepare real recovery provider</Button>
    <p data-testid="recovery-provider-setup">{stage}</p>
    <p data-testid="recovery-provider-authority">{authority}</p>
    <p data-testid="recovery-provider-signs">{signs}</p>
    <p data-testid="recovery-provider-rotation">{rotationState}</p>
    <p data-testid="recovery-provider-fee-binding">{feeBinding}</p>
    <p data-testid="recovery-provider-owner-retained">{String(!!account && wallet.activeAccount?.id === account.id)}</p>
    <p data-testid="recovery-provider-account-count">{wallet.accounts.length}</p>
    <p data-testid="recovery-provider-ledger-ready">{String(wallet.balances !== null && wallet.minimumBalanceXlm !== null)}</p>
    <div hidden>
      <Button onClick={() => { resourceFeeExceeded.current = true; }}>Raise synthetic resource fee</Button>
      <Button onClick={() => { insufficientFeeBalance.current = true; }}>Deplete synthetic fee balance</Button>
      <Button onClick={() => { if (selectedPayerId.current) void wallet.removeAccount(selectedPayerId.current); }}>Remove synthetic fee payer</Button>
      <Button onClick={() => { receiveSyncBlocked.current = false; }}>Restore synthetic receive archive</Button>
      <Button onClick={() => finishRotation.current?.()}>Complete synthetic address rotation</Button>
      <Button onClick={() => { lockVault(); void unlockVault(password).then(() => setAuthority('session-replaced')); }}>Replace synthetic recovery session</Button>
      <Button onClick={() => { wallet.switchNetwork('mainnet'); wallet.switchNetwork('testnet'); setAuthority('network-replaced'); }}>Replace synthetic recovery network</Button>
      <Button onClick={() => { setRetired(true); setAuthority('provider-retired'); }}>Retire synthetic recovery provider</Button>
    </div>
    <SigningPasswordPrompt />
    {account && scenario && !retired ? <PrivateBalanceRuntimeControlProvider scopeKey="synthetic-held-recovery-control"><PrivateBalanceProvider accountId={account.id} accountPublicKey={account.publicKey}
      accountCreatedAt={0} network="testnet" manifest={scenario.manifest} manifestHash={'09'.repeat(32)} storageScope={scenario.scope}
      encryptedStateExists deployment={deployment} asset={fixtureAsset} registryAssets={scenario.manifest.assets}
      runtimeKey="synthetic-recovery-runtime" portfolioKey="synthetic-recovery-portfolio" deploymentId="synthetic-recovery-deployment">
      <Controls scenario={scenario} sponsoredHash={sponsoredHash} fixtureAsset={fixtureAsset} />
    </PrivateBalanceProvider></PrivateBalanceRuntimeControlProvider> : null}
  </main>;
}
