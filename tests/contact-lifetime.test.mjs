import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import * as vault from '../src/lib/vault.ts';
import * as contacts from '../src/lib/contacts.ts';

const password = 'synthetic contact lifetime correct horse battery staple';

class Storage {
  values = new Map();
  writes = 0;
  afterContactWrite = null;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    this.values.set(key, String(value));
    if (key === 'stellarkey.contacts.v1') {
      this.writes += 1;
      this.afterContactWrite?.();
    }
  }
  removeItem(key) { this.values.delete(key); }
}

async function prepare(t) {
  const storage = new Storage();
  globalThis.window = { localStorage: storage };
  vault.lockVault();
  await vault.initializeVault(password, { secret: Keypair.random().secret() });
  t.after(() => vault.lockVault());
  return { storage, contact: { name: 'Synthetic contact', address: Keypair.random().publicKey() } };
}

function holdEncryption(t) {
  const original = crypto.subtle.encrypt;
  let armed = true;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  let resolveGate;
  let rejectGate;
  const gate = new Promise((resolve, reject) => { resolveGate = resolve; rejectGate = reject; });
  crypto.subtle.encrypt = async function (...args) {
    const held = armed;
    armed = false;
    const result = await original.apply(this, args);
    if (held) { entered(); await gate; }
    return result;
  };
  t.after(() => { crypto.subtle.encrypt = original; resolveGate(); });
  return { waiting, resolve: resolveGate, reject: () => rejectGate(new Error('Synthetic encryption failure')) };
}

const settled = promise => promise.then(() => true, () => false);

test('contact storage rejects encrypted results from an earlier session before writing and permits fresh retry', async t => {
  const { storage, contact } = await prepare(t);
  const before = storage.writes;
  const gate = holdEncryption(t);
  const result = settled(vault.savePrivateContactRecords([contact]));
  await gate.waiting;
  vault.lockVault();
  await vault.unlockVault(password);
  gate.resolve();
  const accepted = await result;
  assert.equal(accepted, false);
  assert.equal(storage.writes, before);
  assert.equal((await contacts.loadContacts()).length, 0);
  await contacts.saveContact(contact);
  assert.equal((await contacts.loadContacts()).length, 1);
});

test('an old queued contact mutation cannot acquire the replacement session after its predecessor fails', async t => {
  const { storage, contact } = await prepare(t);
  const before = storage.writes;
  const gate = holdEncryption(t);
  const first = settled(contacts.saveContact(contact));
  await gate.waiting;
  const second = settled(contacts.saveContact({ ...contact, name: 'Queued contact' }));
  vault.lockVault();
  await vault.unlockVault(password);
  gate.reject();
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(storage.writes, before);
  assert.equal((await contacts.loadContacts()).length, 0);
});

test('an already committed contact remains durable but cannot return old-session plaintext after revocation', async t => {
  const { storage, contact } = await prepare(t);
  const before = storage.writes;
  storage.afterContactWrite = () => vault.lockVault();
  const accepted = await settled(contacts.saveContact(contact));
  storage.afterContactWrite = null;
  assert.equal(accepted, false);
  assert.equal(storage.writes, before + 1);
  await vault.unlockVault(password);
  assert.equal((await contacts.loadContacts()).length, 1);
});

for (const action of ['delete', 'favorite']) {
  test(`contact ${action} shares invocation ownership and cannot persist after a session change`, async t => {
    const { storage, contact } = await prepare(t);
    await contacts.saveContact(contact);
    const before = storage.writes;
    const gate = holdEncryption(t);
    const result = settled(action === 'delete' ? contacts.deleteContact(contact.address) : contacts.toggleFavoriteContact(contact.address));
    await gate.waiting;
    vault.lockVault();
    await vault.unlockVault(password);
    gate.resolve();
    assert.equal(await result, false);
    assert.equal(storage.writes, before);
    const retained = await contacts.loadContacts();
    assert.equal(retained.length, 1);
    assert.equal(retained[0].favorite, false);
  });
}
