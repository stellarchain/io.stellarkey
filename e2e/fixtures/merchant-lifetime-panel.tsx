'use client';

import { useEffect, useRef, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { Button } from '@/components/ui';
import { useWallet, useWalletSecurity } from '@/hooks/useWallet';
import { MerchantProvider, useMerchant } from '@/hooks/useMerchant';
import { IndexedDbEncryptedRecordDriver } from '@/lib/indexed-db';
import { getMerchantRepository } from '@/lib/merchant/repository';
import { emptyStore } from '@/lib/merchant/defaults';
import { getMerchantEncryptionKey, lockVault, unlockVault } from '@/lib/vault';

const password = 'synthetic merchant correct horse battery staple';

function MerchantControls({ settled }: { settled(): void }) {
  const merchant = useMerchant();
  return <>
    <p data-testid="merchant-ready">{String(merchant.ready)}</p>
    <p data-testid="merchant-error">{merchant.storageError ? 'error' : 'none'}</p>
    <p data-testid="merchant-issue">{merchant.storageIssue ? 'issue' : 'none'}</p>
    <p data-testid="merchant-size">{merchant.tillTextSize}</p>
    <Button onClick={() => { void merchant.setTillTextSize('large').catch(() => {}).finally(settled); }}>Write large merchant text</Button>
    <Button onClick={() => { void merchant.setTillTextSize('standard').catch(() => {}).finally(settled); }}>Write standard merchant text</Button>
    <Button onClick={() => { void merchant.resetRecoveryData().catch(() => {}).finally(settled); }}>Reset merchant recovery</Button>
  </>;
}

// Real wallet, provider, encryption and IndexedDB; only storage response timing
// is controlled. The runner blocks external traffic and all capture artifacts.
export function MerchantLifetimeFixture() {
  const wallet = useWallet();
  const security = useWalletSecurity();
  const [prepared, setPrepared] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState('idle');
  const [settled, setSettled] = useState(0);
  const [delivered, setDelivered] = useState(0);
  const [vault, setVault] = useState('idle');
  const [competingWriter, setCompetingWriter] = useState('idle');
  const releaseCompetingWriter = useRef<(() => void) | null>(null);
  const gate = useRef<{ mode: string; pending: Array<{ resolve(): void; reject(): void }> }>({ mode: '', pending: [] });
  useEffect(() => {
    const driver = IndexedDbEncryptedRecordDriver.prototype;
    const readPrefix = driver.readPrefix;
    const compare = driver.compareAndSetMany;
    const replace = driver.replacePrefixVerified;
    const control = gate.current;
    const pause = async (mode: string) => {
      if (control.mode !== mode) return;
      control.mode = '';
      setStage(mode);
      try {
        await new Promise<void>((resolve, reject) => control.pending.push({ resolve, reject: () => reject(new Error('Synthetic merchant storage failure')) }));
      } finally {
        setDelivered(value => value + 1);
      }
    };
    driver.readPrefix = async function (prefix) {
      const result = await readPrefix.call(this, prefix);
      if (prefix === 'merchant.records.v1:data:') await pause('read');
      return result;
    };
    driver.compareAndSetMany = async function (...args) {
      const result = await compare.apply(this, args);
      if (args[0] === 'merchant.records.v1:meta') await pause('commit');
      return result;
    };
    driver.replacePrefixVerified = async function (...args) {
      if (args[0] === 'merchant.records.v1:' && control.mode === 'replace-failure') {
        control.mode = '';
        setStage('replace-failed');
        throw new Error('Synthetic merchant clear failure');
      }
      const result = await replace.apply(this, args);
      if (args[0] === 'merchant.records.v1:') await pause('replace');
      return result;
    };
    return () => {
      driver.readPrefix = readPrefix;
      driver.compareAndSetMany = compare;
      driver.replacePrefixVerified = replace;
      for (const pending of control.pending) pending.resolve();
      control.pending = [];
      releaseCompetingWriter.current?.();
    };
  }, []);

  return <main data-app-surface className="min-h-screen p-6">
    <h1>Synthetic merchant lifetime checks</h1>
    <Button onClick={() => { void (async () => {
      await wallet.createWallet(password, { secret: Keypair.random().secret() });
      wallet.completeSetup();
      const key = getMerchantEncryptionKey();
      try { await getMerchantRepository().commit({ ...emptyStore(), revision: 1, writerId: 'synthetic', updatedAt: 1 }, key, null); }
      finally { key.fill(0); getMerchantRepository().clearDecryptedSnapshot(); }
      setPrepared(true);
    })(); }}>Prepare merchant lifetime</Button>
    <Button onClick={() => setMounted(value => !value)}>Toggle merchant provider</Button>
    <Button onClick={() => { gate.current.mode = 'read'; setStage('armed'); }}>Pause merchant read</Button>
    <Button onClick={() => { gate.current.mode = 'commit'; setStage('armed'); }}>Pause merchant commit</Button>
    <Button onClick={() => { gate.current.mode = 'replace'; setStage('armed'); }}>Pause merchant replacement</Button>
    <Button onClick={() => { gate.current.mode = 'replace-failure'; setStage('armed'); }}>Fail merchant erase</Button>
    <Button onClick={() => {
      setCompetingWriter('waiting');
      void navigator.locks.request('stellarkey.merchant.writer.v1', async () => {
        setCompetingWriter('held');
        await new Promise<void>(resolve => { releaseCompetingWriter.current = resolve; });
        releaseCompetingWriter.current = null;
        setCompetingWriter('released');
      });
    }}>Hold competing merchant writer</Button>
    <Button onClick={() => releaseCompetingWriter.current?.()}>Release competing merchant writer</Button>
    <Button onClick={() => gate.current.pending.shift()?.resolve()}>Deliver merchant response</Button>
    <Button onClick={() => gate.current.pending.shift()?.reject()}>Fail merchant response</Button>
    <Button onClick={() => { lockVault(); setVault('locked'); }}>Revoke merchant vault directly</Button>
    <Button onClick={() => { void unlockVault(password).then(() => setVault('unlocked')); }}>Replace merchant vault directly</Button>
    <Button onClick={() => wallet.lock()}>Lock merchant wallet</Button>
    <Button onClick={() => { void wallet.unlock(password); }}>Unlock merchant wallet</Button>
    <Button onClick={() => { void security.approveSigningAuthorization(password); }}>Approve synthetic merchant reset</Button>
    <Button onClick={() => { void new IndexedDbEncryptedRecordDriver().putVerified('merchant.records.v1:meta', '{').then(() => setStage('damaged')); }}>Damage synthetic merchant metadata</Button>
    <Button onClick={() => {
      const channel = new BroadcastChannel('stellarkey.merchant.revisions.v1');
      channel.postMessage({ revision: 2, writerId: 'synthetic' });
      channel.close();
    }}>Reload merchant externally</Button>
    <p data-testid="merchant-prepared">{String(prepared)}</p>
    <p data-testid="merchant-stage">{stage}</p>
    <p data-testid="merchant-delivered">{delivered}</p>
    <p data-testid="merchant-settled">{settled}</p>
    <p data-testid="merchant-vault">{vault}</p>
    <p data-testid="merchant-competing-writer">{competingWriter}</p>
    <p data-testid="merchant-phase">{wallet.phase}</p>
    <p data-testid="merchant-authorization">{security.signingAuthorizationRequest ? 'waiting' : 'none'}</p>
    {prepared && mounted ? <MerchantProvider><MerchantControls settled={() => setSettled(value => value + 1)} /></MerchantProvider> : null}
  </main>;
}
