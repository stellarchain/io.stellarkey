import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Send owns a Public | Private mode and keeps private-address handoff in the same surface', () => {
  const send = read('src/components/SendModal.tsx');
  const privateSend = read('src/features/private-balance/components/SendPrivate.tsx');
  assert.match(send, /isPrivateReceiveAddressLike/);
  assert.match(send, /@\/lib\/private-address/);
  assert.match(send, /initialMode = "public"/);
  assert.match(send, /useState<"public" \| "private">\(initialMode\)/);
  assert.match(send, /label: "Public"/);
  assert.match(send, /label: "Private"/);
  assert.match(send, /requestRuntime\(\)/);
  assert.match(send, /const PrivateSend = dynamic\(/);
  assert.match(send, /module\.SendPrivate/);
  assert.match(send, /privatePrefill/);
  assert.match(send, /This is a private address/);
  assert.match(send, />\s*Send Privately\s*</);
  assert.match(send, /openPrivateSend\(destination\.trim\(\)\)/);
  assert.equal([...send.matchAll(/<Modal\b/g)].length, 1);
  const privateSendStart = send.indexOf('<PrivateSend');
  const privateSendEnd = send.indexOf('/>', privateSendStart);
  assert.ok(privateSendStart >= 0 && privateSendEnd > privateSendStart);
  assert.match(send.slice(privateSendStart, privateSendEnd), /embedded/);
  assert.match(privateSend, /embedded\?: boolean/);
});

test('Send reviews reusable private recipients in place without a modal handoff', () => {
  const send = read('src/components/SendModal.tsx');
  const addresses = read('src/lib/private-address.ts');

  assert.match(addresses, /export function isStealthMetaAddressLike/);
  assert.match(send, /isStealthMetaAddressLike/);
  assert.match(send, /prepareStealthPayment/);
  assert.match(send, /submitStealthPayment/);
  assert.match(send, /Reusable private recipient/);
  assert.match(send, /One-time account/);
  assert.match(send, /Recipient reserve/);
  assert.match(send, /Sweep fee buffer/);
  assert.match(send, /Announcement/);
  assert.match(send, /selectedAsset\?\.isNative/);
  assert.doesNotMatch(send, /openPrivateSend\(destination\.trim\(\)\)[\s\S]{0,300}Reusable private recipient/);
});

test('Receive offers Public | Private for enabled assets and gates setup per selection', () => {
  const receive = read('src/components/ReceiveModal.tsx');
  assert.match(receive, /<Tabs/);
  assert.doesNotMatch(receive, /SegmentedControl/);
  assert.match(receive, /label: "Public"/);
  assert.match(receive, /label: "Private"/);
  assert.match(receive, /ariaLabel="Receive address type"/);
  assert.match(receive, /value=\{receiveMode\}/);
  assert.match(receive, /initialMode = "public"/);
  assert.match(receive, /useState<"public" \| "private">\(initialMode\)/);
  assert.match(receive, /availableAssets/);
  assert.match(receive, /startRuntimeTransition\(requestRuntime\)/);
  assert.doesNotMatch(receive, /privateConfigured/);
  assert.match(receive, /const PrivateReceiveContent = dynamic\(/);
  assert.match(receive, /module\.PrivateReceiveContent/);
  assert.match(receive, /const PrivateSetupContent = dynamic\(/);
  assert.match(receive, /PrivateAssetSelector/);
  assert.match(receive, /ssr: false/);
});

test('Add uses Public for trustlines and Private for deposits in one mode shell', () => {
  const shell = read('src/components/AddAssetModalShell.tsx');
  const publicAdd = read('src/components/AddAssetModal.tsx');
  const privateAdd = read('src/features/private-balance/components/AddPrivateFunds.tsx');
  const publicSurface = publicAdd.split('export function ConfirmModal')[0];

  assert.match(shell, /useState<"public" \| "private">\("public"\)/);
  assert.match(shell, /<Tabs/);
  assert.match(shell, /label: "Public"/);
  assert.match(shell, /label: "Private"/);
  assert.match(shell, /ariaLabel="Where to add funds"/);
  assert.match(shell, /startRuntimeTransition\(requestRuntime\)/);
  assert.match(shell, /const AddAssetPublicPanel = dynamic\(/);
  assert.match(shell, /const PrivateAddFunds = dynamic\(/);
  assert.match(shell, /module\) => module\.AddPrivateFunds/);
  assert.match(shell, /PrivateSetupContent action="add"/);
  const privateAddStart = shell.indexOf('<PrivateAddFunds');
  const privateAddEnd = shell.indexOf('/>', privateAddStart);
  assert.ok(privateAddStart >= 0 && privateAddEnd > privateAddStart);
  assert.match(shell.slice(privateAddStart, privateAddEnd), /embedded/);
  assert.equal([...shell.matchAll(/<Modal\b/g)].length, 1);
  assert.equal([...publicSurface.matchAll(/<Modal\b/g)].length, 0);
  assert.match(publicAdd, /export function AddAssetPublicPanel/);
  assert.match(publicAdd, /embedded\?: boolean/);
  assert.match(privateAdd, /embedded\?: boolean/);
  assert.match(privateAdd, /PrivateAssetSelector/);
  assert.match(privateAdd, /onBeforeLeaveChange\?:/);
  assert.doesNotMatch(privateAdd, /modeControl/);
});

test('Add switches modes with the familiar tabs without replacing the modal', () => {
  const add = read('src/components/AddAssetModalShell.tsx');

  assert.match(add, /<Tabs/);
  assert.match(add, /<Modal open onClose=\{requestClose\} wide dismissable=\{!surfaceBusy\}>/);
  assert.match(add, /closeDisabled=\{surfaceBusy\}/);
  assert.doesNotMatch(add, /SegmentedControl/);
  assert.doesNotMatch(add, /function AddModeSwitch/);
  assert.doesNotMatch(add, /modeTarget/);
  assert.doesNotMatch(add, /modeTransitioning/);
  assert.doesNotMatch(add, /setTimeout/);
});

test('the shell integrates private payments through the palette and an asset detail modal', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  // Palette actions share the runtime's exact gating.
  assert.match(
    dashboard,
    /privateBalanceAvailable \|\| showPrivatePayments[\s\S]{0,600}?Send Privately[\s\S]{0,600}?Receive Privately[\s\S]{0,300}?Open private asset/,
  );
  assert.match(dashboard, /setSendInitialMode\("private"\)[\s\S]{0,100}?setSendOpen\(true\)/);
  assert.match(dashboard, /<SendModal[\s\S]{0,200}?initialMode=\{sendInitialMode\}/);
  // "Receive Privately" opens the shared receive sheet in Private mode.
  assert.match(dashboard, /setReceiveInitialMode\("private"\)[\s\S]{0,100}?setReceiveOpen\(true\)/);
  assert.match(dashboard, /<ReceiveModal[\s\S]{0,160}?initialMode=\{receiveInitialMode\}/);
  assert.doesNotMatch(dashboard, /requestPrivateSend|requestPrivateReceive/);
  // Send and Receive own their mode switch; Dashboard no longer closes one
  // sheet just to open another.
  assert.doesNotMatch(dashboard, /onOpenPrivateSend=/);
  assert.doesNotMatch(dashboard, /privateConfigured=/);
  // Private assets use a focused detail modal, not a second dashboard or a
  // standalone navigation destination.
  assert.match(dashboard, /privateAssetOpen/);
  assert.match(dashboard, /<PrivateAssetDetailModal/);
  assert.doesNotMatch(dashboard, /<PrivateBalanceCard privacyMode=\{privacyMode\}/);
  assert.doesNotMatch(dashboard, /switchTab\("private"\)/);
  assert.doesNotMatch(dashboard, /stellarkey\.private\.shield-prompt\.v1/);
  // Home never recommends moving a calculated amount into private assets.
  assert.doesNotMatch(dashboard, /shieldPromptSuggestedXlm/);
  assert.doesNotMatch(dashboard, /Move .* XLM to your private/);
  assert.doesNotMatch(dashboard, /aria-label="Dismiss private balance suggestion"/);
});

test('the main balance exposes private withdrawal only for configured assets', () => {
  const dashboard = read('src/components/Dashboard.tsx');

  assert.match(dashboard, /privateWithdrawEntry/);
  assert.match(dashboard, /privatePortfolioEntries\.find[\s\S]{0,220}?asset\.kind === "native"/);
  assert.match(dashboard, /privateWithdrawEntry && \(/);
  assert.match(dashboard, /label="Withdraw"/);
  assert.match(dashboard, /<WithdrawPrivate/);
  assert.match(dashboard, /selectPrivateAsset\(privateWithdrawEntry\.deploymentId\)/);
});

test('a pasted public address in private Send hands off to the regular Send, prefilled', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  const send = read('src/features/private-balance/components/SendPrivate.tsx');

  // The private flow raises the shell-side event with the destination…
  assert.match(send, /requestPublicSend\(trimmedRecipient\)/);
  // …and the shell opens SendModal with the destination prefilled.
  assert.match(dashboard, /PUBLIC_SEND_REQUEST_EVENT/);
  assert.match(dashboard, /addEventListener\(PUBLIC_SEND_REQUEST_EVENT/);
  assert.match(dashboard, /removeEventListener\(PUBLIC_SEND_REQUEST_EVENT/);
  assert.match(
    dashboard,
    /setSendPrefill\(\s*typeof destination === "string" && destination !== "" \? \{ destination \} : null,?\s*\);[\s\S]{0,80}?setSendOpen\(true\)/,
  );
});
