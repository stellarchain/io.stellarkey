'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { Button } from '@/components/ui';
import { ToastProvider, useToast } from '@/components/Toast';
import { CustomersPage } from '@/components/merchant/CustomersPage';
import { PaymentLinksPage } from '@/components/merchant/PaymentLinksPage';
import {
  MerchantProvider, useMerchant, useMerchantConfiguration, useMerchantRecords,
  useMerchantReporting, useMerchantStaff, useMerchantStatus, useMerchantTill,
} from '@/hooks/useMerchant';
import { useWallet, useWalletSecurity } from '@/hooks/useWallet';
import { IndexedDbEncryptedRecordDriver } from '@/lib/indexed-db';
import { getMerchantRepository } from '@/lib/merchant/repository';
import { emptyStore } from '@/lib/merchant/defaults';
import { createCounterCode } from '@/lib/merchant/counter-codes';
import { createMerchantPinCredential } from '@/lib/merchant/pin';
import { getMerchantEncryptionKey, lockVault, unlockVault } from '@/lib/vault';
import type { MerchantStore, StaffMember } from '@/lib/merchant/types';

const password = 'synthetic merchant feedback correct horse battery staple';
type Gate = { resolve(): void; reject(): void };

function LocalToastControl() {
  const { toast } = useToast();
  return <Button onClick={() => toast('Local supplementary message.')}>Local toast</Button>;
}

function MerchantContextEquivalenceProbe() {
  const aggregate = useMerchant();
  const status = useMerchantStatus();
  const configuration = useMerchantConfiguration();
  const staff = useMerchantStaff();
  const till = useMerchantTill();
  const records = useMerchantRecords();
  const reporting = useMerchantReporting();
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = marker.current;
    if (!node) return;
    // Compare the real contexts in memory. Retain/output only structural counts
    // and booleans, never field names, merchant values, or serialized records.
    const entries = [status, configuration, staff, till, records, reporting].flatMap(Object.entries);
    const expected = new Map(entries);
    const actual = Object.entries(aggregate);
    const mismatches = actual.filter(([key, value]) => !expected.has(key) || !Object.is(value, expected.get(key))).length
      + Number(actual.length !== expected.size) + Number(entries.length !== expected.size);
    Object.assign(node.dataset, {
      fields: String(actual.length),
      callbacks: String(actual.filter(([, value]) => typeof value === 'function').length),
      references: String(actual.filter(([, value]) => value !== null && typeof value === 'object').length),
      mismatches: String(Number(node.dataset.mismatches ?? 0) + mismatches),
      snapshots: String(Number(node.dataset.snapshots ?? 0) + 1),
      large: String(aggregate.tillTextSize === 'large'), lines: String(aggregate.ticket.lines.length),
      orders: String(aggregate.orders.length), online: String(aggregate.online),
      active: String(aggregate.activeStaff !== null), reports: String(aggregate.canSeeReports),
    });
  });
  return <span ref={marker} data-testid="merchant-context-equivalence" hidden />;
}

function FeedbackPanels({ resetDone }: { resetDone(): void }) {
  const merchant = useMerchant();
  const wallet = useWallet();
  const [panel, setPanel] = useState('customers');
  const [authentication, setAuthentication] = useState('idle');
  const [contactsSettled, setContactsSettled] = useState(0);
  const [contextSettled, setContextSettled] = useState(0);
  const [contextFailure, setContextFailure] = useState(false);
  function trackContext(operation: Promise<unknown>) {
    void operation.then(() => setContextSettled(value => value + 1), () => setContextFailure(true));
  }
  return <>
    <MerchantContextEquivalenceProbe />
    <p data-testid="feedback-context-settled">{contextSettled}</p>
    <p data-testid="feedback-context-failure">{String(contextFailure)}</p>
    <p data-testid="feedback-ready">{String(merchant.ready)}</p>
    <p data-testid="feedback-staff">{merchant.activeStaff ? 'active' : 'none'}</p>
    <p data-testid="feedback-issue">{merchant.storageIssue ? 'issue' : 'none'}</p>
    <p data-testid="feedback-authentication">{authentication}</p>
    <p data-testid="feedback-provider-settled">{contactsSettled}</p>
    <p data-testid="feedback-customer-count">{merchant.customers.length}</p>
    <p data-testid="feedback-events">{merchant.customers.reduce((sum, customer) => sum + (customer.loyalty?.events.length ?? 0), 0)}</p>
    <Button onClick={() => { setAuthentication('waiting'); void merchant.switchStaff('fixture-owner', '2468').then(() => setAuthentication('done'), () => setAuthentication('refused')); }}>Authenticate merchant staff</Button>
    <Button onClick={() => trackContext(merchant.setTillTextSize('large'))}>Update aggregate configuration</Button>
    <Button onClick={() => merchant.addCustomAmount(100, 'Synthetic item')}>Add aggregate ticket line</Button>
    <Button onClick={() => trackContext(merchant.openShift(0))}>Open aggregate shift</Button>
    <Button onClick={() => trackContext(merchant.settleCash(100))}>Settle aggregate cash</Button>
    <Button onClick={() => trackContext(merchant.lockStaffSession())}>Lock aggregate staff</Button>
    <Button onClick={() => setPanel('customers')}>Show customer actions</Button>
    <Button onClick={() => setPanel('codes')}>Show code actions</Button>
    <Button onClick={() => setPanel('hidden')}>Hide merchant actions</Button>
    <Button onClick={() => { void merchant.resetRecoveryData().catch(() => {}).finally(resetDone); }}>Reset feedback merchant</Button>
    <Button onClick={() => { void (async () => {
      for (const customer of merchant.customers) await wallet.addContact({ name: 'Synthetic contact', address: customer.address });
    })().catch(() => {}).finally(() => setContactsSettled(value => value + 1)); }}>Seed provider contacts</Button>
    {(['save', 'remove', 'favorite'] as const).map(action => <Button key={action} onClick={() => {
      const address = merchant.customers[0]?.address;
      if (!address) return;
      const operation = action === 'save' ? wallet.addContact({ name: 'Updated contact', address }) : action === 'remove' ? wallet.removeContact(address) : wallet.toggleContactFavorite(address);
      void operation.catch(() => {}).finally(() => setContactsSettled(value => value + 1));
    }}>Run provider contact {action}</Button>)}
    {merchant.ready && (panel === 'customers' ? <CustomersPage /> : panel === 'codes' ? <PaymentLinksPage /> : null)}
  </>;
}

export function MerchantFeedbackFixture() {
  const { toast } = useToast();
  const wallet = useWallet();
  const latestWallet = useRef(wallet);
  useLayoutEffect(() => { latestWallet.current = wallet; }, [wallet]);
  const security = useWalletSecurity();
  const [prepared, setPrepared] = useState(false);
  const [localToasts, setLocalToasts] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [stage, setStage] = useState('idle');
  const [writes, setWrites] = useState(0);
  const [contacts, setContacts] = useState(0);
  const [deliveries, setDeliveries] = useState(0);
  const [resets, setResets] = useState(0);
  const gates = useRef({ before: false, after: false, encrypt: false, erase: false, contactFailure: false, revokeAfterContact: false, pending: [] as Gate[] });

  useEffect(() => {
    const control = gates.current;
    const driver = IndexedDbEncryptedRecordDriver.prototype;
    const compare = driver.compareAndSetMany;
    const replace = driver.replacePrefixVerified;
    const encrypt = SubtleCrypto.prototype.encrypt;
    const setItem = Storage.prototype.setItem;
    const pause = async (label: string) => {
      setStage(label);
      try { await new Promise<void>((resolve, reject) => control.pending.push({ resolve, reject: () => reject(new Error('Synthetic private failure payload')) })); }
      finally { setDeliveries(value => value + 1); }
    };
    driver.compareAndSetMany = async function (...args) {
      if (args[0] !== 'merchant.records.v1:meta') return compare.apply(this, args);
      setWrites(value => value + 1);
      if (control.before) { control.before = false; await pause('before-write'); }
      const result = await compare.apply(this, args);
      if (control.after) { control.after = false; await pause('after-write'); }
      return result;
    };
    driver.replacePrefixVerified = async function (...args) {
      if (args[0] === 'merchant.records.v1:' && control.erase) {
        control.erase = false;
        throw new Error('Synthetic erase failure payload');
      }
      return replace.apply(this, args);
    };
    SubtleCrypto.prototype.encrypt = async function (...args) {
      const held = control.encrypt;
      if (held) control.encrypt = false;
      const result = await encrypt.apply(this, args);
      if (held) await pause('contact-encryption');
      return result;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'stellarkey.contacts.v1') {
        setContacts(count => count + 1);
        if (control.contactFailure) { control.contactFailure = false; throw new Error('Synthetic contact failure payload'); }
      }
      const result = setItem.call(this, key, value);
      if (key === 'stellarkey.contacts.v1' && control.revokeAfterContact) {
        control.revokeAfterContact = false;
        latestWallet.current.lock();
      }
      return result;
    };
    return () => {
      driver.compareAndSetMany = compare;
      driver.replacePrefixVerified = replace;
      SubtleCrypto.prototype.encrypt = encrypt;
      Storage.prototype.setItem = setItem;
      for (const pending of control.pending) pending.resolve();
      control.pending = [];
    };
  }, []);

  return <main data-app-surface className="min-h-screen p-4">
    <h1>Merchant feedback checks</h1>
    <Button onClick={() => toast('First supplementary message.')}>First toast</Button>
    <Button onClick={() => toast('Second supplementary message.')}>Second toast</Button>
    <Button onClick={() => toast('A longer supplementary message that stays readable on a narrow screen and wraps instead of hiding its required feedback.')}>Long toast</Button>
    <Button onClick={() => toast('Fourth supplementary message.')}>Fourth toast</Button>
    <Button onClick={() => setLocalToasts(value => !value)}>Toggle local toast provider</Button>
    {localToasts && <ToastProvider><LocalToastControl /></ToastProvider>}
    <Button onClick={() => { void (async () => {
      await wallet.createWallet(password, { secret: Keypair.random().secret() });
      wallet.completeSetup();
      const base = emptyStore();
      const actor: StaffMember = { id: 'fixture-owner', name: 'Fixture owner', role: 'owner', active: true,
        pinDigest: await createMerchantPinCredential('2468'), pinSetAt: Date.now(),
        permissions: { takePayment: true, applyDiscount: true, comp: true, void: true, refundCeilingMinor: null, openDrawer: true, seeReports: true, exportRecords: true } };
      const destination = Keypair.random().publicKey();
      const asset = { code: 'XLM', issuer: null };
      let store: MerchantStore = { ...base, staff: [actor], activeStaffId: actor.id, onShiftStaffIds: [actor.id],
        settings: { ...base.settings, receivingPublicKey: destination, profile: { ...base.settings.profile, name: 'Fixture shop' } },
        customers: [0, 1].map(index => ({ address: Keypair.random().publicKey(), name: index ? 'Fixture reward' : 'Fixture customer',
          firstSeenAt: Date.now(), lastSeenAt: Date.now(), orderCount: 1, lifetimeMinor: 100, averageMinor: 100, preferredAsset: asset, sourceIds: [], note: null,
          loyalty: index ? { stamps: 10, target: 10, redeemedCount: 0, events: [] } : null })) };
      for (const index of [0, 1]) store = createCounterCode(store, { id: `fixture-code-${index}`, actor, title: index ? 'Second code' : 'First code', kind: 'open',
        amountMinor: null, suggestedMinor: [], acceptedAssets: [asset], memoPrefix: index ? 'SECOND' : 'FIRST', staffId: null, expiresAt: null,
        network: 'testnet', destination, quotes: [], routingId: String(index + 1) }).store;
      const key = getMerchantEncryptionKey();
      try { await getMerchantRepository().commit({ ...store, revision: 1, writerId: 'fixture', updatedAt: Date.now() }, key, null); }
      finally { key.fill(0); getMerchantRepository().clearDecryptedSnapshot(); }
      setPrepared(true);
    })().catch(() => setStage('prepare-failed')); }}>Prepare feedback merchant</Button>
    <Button onClick={() => { gates.current.before = true; setStage('armed'); }}>Hold before merchant write</Button>
    <Button onClick={() => { gates.current.after = true; setStage('armed'); }}>Hold after merchant write</Button>
    <Button onClick={() => { gates.current.encrypt = true; setStage('armed'); }}>Hold contact encryption</Button>
    <Button onClick={() => { gates.current.contactFailure = true; }}>Fail next contact write</Button>
    <Button onClick={() => { gates.current.revokeAfterContact = true; }}>Revoke after contact commit</Button>
    <Button onClick={() => { gates.current.erase = true; }}>Fail feedback erase</Button>
    <Button onClick={() => gates.current.pending.shift()?.resolve()}>Deliver feedback response</Button>
    <Button onClick={() => gates.current.pending.shift()?.reject()}>Reject feedback response</Button>
    <Button onClick={() => setMounted(value => !value)}>Toggle feedback provider</Button>
    <Button onClick={() => wallet.lock()}>Lock feedback wallet</Button>
    <Button onClick={() => { void wallet.unlock(password); }}>Unlock feedback wallet</Button>
    <Button onClick={() => lockVault()}>Revoke feedback vault</Button>
    <Button onClick={() => { void unlockVault(password); }}>Replace feedback vault</Button>
    <Button onClick={() => { void security.approveSigningAuthorization(password); }}>Authorize feedback reset</Button>
    <Button onClick={() => { void (async () => {
      const repository = getMerchantRepository();
      const key = getMerchantEncryptionKey();
      try {
        const result = await repository.load(key);
        if (result.kind !== 'ready') return;
        await repository.commit({ ...result.value, revision: result.value.revision + 1, writerId: 'fixture-refresh', updatedAt: Date.now(),
          counterCodes: result.value.counterCodes.map(code => code.id === 'fixture-code-0' ? { ...code, routingId: String(BigInt(code.routingId) + 100n), title: 'Changed code' } : code),
        }, key, result.value.revision);
        const channel = new BroadcastChannel('stellarkey.merchant.revisions.v1');
        channel.postMessage({ revision: result.value.revision + 1, writerId: 'fixture-refresh' });
        channel.close();
      } finally { key.fill(0); }
    })().catch(() => setStage('refresh-failed')); }}>Replace synthetic code request</Button>
    <p data-testid="feedback-stage">{stage}</p>
    <p data-testid="feedback-writes">{writes}</p>
    <p data-testid="feedback-contacts">{contacts}</p>
    <p data-testid="feedback-deliveries">{deliveries}</p>
    <p data-testid="feedback-resets">{resets}</p>
    <p data-testid="feedback-phase">{wallet.phase}</p>
    <p data-testid="feedback-contact-count">{wallet.contacts.length}</p>
    <p data-testid="feedback-authorization">{security.signingAuthorizationRequest ? 'waiting' : 'none'}</p>
    {prepared && mounted && <MerchantProvider><FeedbackPanels resetDone={() => setResets(count => count + 1)} /></MerchantProvider>}
  </main>;
}
