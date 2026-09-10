import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('private balance surfaces use factual privacy claims and exact amount formatting', () => {
  const card = read('src/features/private-balance/components/PrivateBalanceCard.tsx');
  const setup = read('src/features/private-balance/components/PrivateBalanceSetupBody.tsx');
  const disclosure = read('src/features/private-balance/components/PrivacyDisclosure.tsx');
  const status = read('src/features/private-balance/components/PrivateBalanceStatus.tsx');
  const dashboard = read('src/components/Dashboard.tsx');
  const copy = `${card}\n${setup}\n${disclosure}\n${status}`;

  assert.doesNotMatch(copy, /anonymous|untraceable|100% confidential|metadata-free|secretly/i);
  assert.match(disclosure, /Stellar account that submits and pays network fees/i);
  assert.match(copy, /timing/i);
  assert.match(disclosure, /independent activity/i);
  assert.match(disclosure, /not a guarantee/i);
  assert.doesNotMatch(copy, /anonymity score|privacy score/i);
  assert.match(card, /usePrivateBalanceRuntimeData\(\)/);
  assert.doesNotMatch(card, /runtime\/provider|usePrivateBalance\(\)/);
  assert.match(dashboard, /dynamic\([\s\S]*PrivateBalanceAssetRow/);
  assert.match(dashboard, /dynamic\([\s\S]*PrivateAssetDetailModal/);
  assert.match(dashboard, /requestPrivateRuntime\(\)/);
  assert.match(dashboard, /ALLOW_PRIVATE_BALANCE_DEVELOPMENT_FIXTURE/);
  assert.match(status, /development|testnet-preview|testnet-beta|production/);
  assert.match(status, /Testnet preview/);
  assert.match(status, /Not recorded/);
  for (const phase of [
    'disabled',
    'loading-artifacts',
    'reading-meta',
    'scanning-live',
    'current',
    'status-unknown',
    'safe-error',
  ]) assert.match(status, new RegExp(phase));
  // Vocabulary bans hold on the always-visible surfaces (identifiers live
  // only behind the collapsed Technical details disclosure).
  assert.doesNotMatch(copy, /Merkle|nullifier|UTXO|checkpoint|archive page/i);
  assert.doesNotMatch(copy, /\bpool\b/i);
});

test('the card is self-contained: no submission plumbing, no consolidation or progress modals', () => {
  const card = read('src/features/private-balance/components/PrivateBalanceCard.tsx');

  assert.doesNotMatch(card, /submissionStatus|onSubmission|onConsolidate/);
  assert.doesNotMatch(card, /ConsolidatePrivate|PrivateProgress|PrivateSubmissionStatus/);
  assert.match(card, /<SendPrivate[\s\S]{0,120}onClose=/);
  assert.match(card, /prefill=/);
  assert.match(card, /prefillAmount=/);
  assert.match(card, /<WithdrawPrivate onClose=/);
});

test('the card shows fiat, four actions, one Details chip, and no sync chip or status pill', () => {
  const card = read('src/features/private-balance/components/PrivateBalanceCard.tsx');

  assert.match(card, /FiatValue/);
  assert.match(card, /label="Send"[\s\S]*label="Receive"[\s\S]*label="Withdraw"[\s\S]*label="Add"/);
  assert.doesNotMatch(card, /label="Move out"/);
  assert.match(card, /mt-8 grid w-full max-w-\[360px\] grid-cols-4 gap-2/);
  assert.match(card, /mt-5 flex flex-wrap items-center justify-center gap-2/);
  assert.match(card, />\s*Details\s*</);
  assert.doesNotMatch(card, /aria-label="Sync Private Balance"|>Sync</);
  assert.doesNotMatch(card, /PHASE_LABELS/);
  assert.match(card, /privateBalanceStatusLine/);
  assert.match(card, /privateBalancePendingLine/);
  assert.match(card, /privacyMode/);
  assert.match(card, /••••••/);
  assert.match(card, /statusUnknown \? '—'/);
  assert.match(card, /formatPrivateBalanceAmount/);
  assert.match(card, /fmtAmount/);
  // Buttons need the current phase on the leader tab; Receive only needs the
  // durable private address.
  assert.match(card, /const actionable = current && isLeader/);
  assert.match(card, /disabled=\{privateAddress === null\}/);
  assert.match(card, /depositsPaused === true/);
});

test('independent RPC failures explain status unknown without exposing protocol jargon', async () => {
  const { humanizePrivateError } = await import('../src/features/private-balance/copy.ts');
  const disagreement = humanizePrivateError(
    new Error('Private Payments RPC views disagree on an overlapping ledger hash.'),
  );
  assert.equal(disagreement.title, "Network views don't agree");
  assert.match(disagreement.body, /last checked balance is unchanged/i);
  const outage = humanizePrivateError(
    new Error('The independent Private Payments witness RPC is unavailable.'),
  );
  assert.equal(outage.title, 'Independent check unavailable');
  assert.match(outage.body, /last checked balance is unchanged/i);
});

test('the card consumes handoff intents and listens for live requests', () => {
  const card = read('src/features/private-balance/components/PrivateBalanceCard.tsx');

  assert.match(card, /consumePrivateSendIntent\(\)/);
  assert.match(card, /consumePrivateAddIntent\(\)/);
  assert.match(card, /consumePrivateReceiveIntent\(\)/);
  assert.match(card, /PRIVATE_SEND_REQUEST_EVENT/);
  assert.match(card, /PRIVATE_ADD_REQUEST_EVENT/);
  assert.match(card, /PRIVATE_RECEIVE_REQUEST_EVENT/);
  assert.match(card, /addEventListener\(PRIVATE_SEND_REQUEST_EVENT/);
  assert.match(card, /removeEventListener\(PRIVATE_ADD_REQUEST_EVENT/);
  assert.match(card, /removeEventListener\(PRIVATE_RECEIVE_REQUEST_EVENT/);
  // Nothing is consumed while unconfigured (or while setup's success screen
  // is still up): the stored intent waits for the post-setup drain instead of
  // silently vanishing under the setup modal.
  assert.match(card, /if \(!configured \|\| setupOpen\) return undefined;/);
  assert.match(card, /\}, \[configured, setupOpen\]\);/);
});

test('a follower tab offers Use Here instead of dead buttons', () => {
  const card = read('src/features/private-balance/components/PrivateBalanceCard.tsx');

  assert.match(card, /const follower = configured && !isLeader/);
  assert.match(card, /Active in another tab/);
  assert.match(card, /Use Here/);
  assert.match(card, /takeoverLeadership\(\)/);
});

test('only the live asset administrator sees append and exit-only controls', () => {
  const settings = read('src/features/private-balance/components/PrivateProtocolSettings.tsx');
  const admin = read('src/features/private-balance/components/PrivateAssetRegistryAdmin.tsx');

  assert.match(settings, /<PrivateAssetRegistryAdmin \/>/);
  assert.match(admin, /publicAddress === deployment\.assetAdminAddress/);
  assert.match(admin, /Add asset contract/);
  assert.match(admin, /Set exit only/);
  assert.match(admin, /Allow deposits/);
  assert.match(admin, /registry entries are never deleted/i);
  assert.doesNotMatch(admin, /removeAsset|deleteAsset|remove_asset|delete_asset/);
  assert.match(admin, /retryRuntime\(\)/);
});

test('the ambient status line follows the D1 rules', async () => {
  const { privateBalanceStatusLine } = await import(
    '../src/features/private-balance/components/PrivateBalanceStatusLine.ts'
  );
  const base = {
    phase: 'current',
    backgroundSyncing: false,
    syncProgress: null,
    error: null,
    depositsPaused: null,
  };

  // Silence when healthy — including during a routine background sync.
  assert.equal(privateBalanceStatusLine(base), null);
  assert.equal(privateBalanceStatusLine({ ...base, backgroundSyncing: true }), null);

  assert.deepEqual(
    privateBalanceStatusLine({ ...base, phase: 'loading-artifacts' }),
    { label: 'Getting ready…', tone: 'neutral' },
  );
  assert.deepEqual(
    privateBalanceStatusLine({
      ...base,
      phase: 'scanning-live',
      syncProgress: { current: 2, total: 5 },
    }),
    { label: 'Updating… 2 of 5', tone: 'neutral' },
  );
  assert.deepEqual(
    privateBalanceStatusLine({ ...base, phase: 'reading-meta' }),
    { label: 'Updating…', tone: 'neutral' },
  );
  assert.deepEqual(
    privateBalanceStatusLine({ ...base, depositsPaused: true }),
    { label: 'Deposits paused · withdrawals still work', tone: 'caution' },
  );
  assert.deepEqual(
    privateBalanceStatusLine({ ...base, phase: 'status-unknown' }),
    { label: 'Status unknown · last checked balance unchanged', tone: 'caution' },
  );

  const safeError = privateBalanceStatusLine({
    ...base,
    phase: 'safe-error',
    error: 'Private Balance record transcript mismatch',
  });
  assert.equal(safeError.tone, 'caution');
  assert.doesNotMatch(safeError.label, /archive|page|Merkle/i);
});

test('the pending line sums confirming amounts net of change', async () => {
  const { privateBalancePendingLine } = await import(
    '../src/features/private-balance/components/PrivateBalanceStatusLine.ts'
  );
  const confirming = action => ({
    status: 'broadcast',
    broadcastAttempts: 1,
    recipientFingerprint: action.kind === 'transfer' ? 'AAAA BBBB' : undefined,
    ...action,
  });

  assert.equal(privateBalancePendingLine([], 7, 'XLM'), null);
  assert.equal(
    privateBalancePendingLine([confirming({ kind: 'transfer', amountStroops: '250000000' })], 7, 'XLM'),
    '− 25 XLM confirming…',
  );
  assert.equal(
    privateBalancePendingLine([
      confirming({ kind: 'transfer', amountStroops: '250000000' }),
      confirming({ kind: 'withdraw', amountStroops: '50000000' }),
    ], 7, 'XLM'),
    '− 30 XLM confirming…',
  );
  assert.equal(
    privateBalancePendingLine([confirming({ kind: 'deposit', amountStroops: '100000000' })], 7, 'XLM'),
    '+ 10 XLM confirming…',
  );
  // Legacy pending actions without a durable amount stay silent.
  assert.equal(privateBalancePendingLine([confirming({ kind: 'transfer' })], 7, 'XLM'), null);
});

test('the pending line distinguishes undisclosed work from unsigned exposed spends and masks private amounts', async () => {
  const { privateBalancePendingLine, isConfirmingPendingAction, isInternalPendingAction } = await import(
    '../src/features/private-balance/components/PrivateBalanceStatusLine.ts'
  );

  // Only an explicitly local proof can still be treated as undisclosed.
  for (const status of ['prepared', 'reviewed']) {
    assert.equal(
      privateBalancePendingLine([
        { kind: 'transfer', status, proofExposure: 'local', broadcastAttempts: 0, amountStroops: '250000000', recipientFingerprint: 'AAAA BBBB' },
      ], 7, 'XLM'),
      null,
    );
    assert.equal(isConfirmingPendingAction({ status, broadcastAttempts: 0 }), false);
    for (const proofExposure of ['shared', undefined]) {
      const exposed = { kind: 'transfer', status, proofExposure, broadcastAttempts: 0, amountStroops: '250000000', recipientFingerprint: 'AAAA BBBB' };
      assert.equal(isConfirmingPendingAction(exposed), true);
      assert.equal(privateBalancePendingLine([exposed], 7, 'XLM'), 'Payment status unknown · inputs remain reserved');
    }
  }
  assert.equal(isConfirmingPendingAction({ status: 'signed', broadcastAttempts: 0 }), true);
  assert.equal(isConfirmingPendingAction({ status: 'broadcast', broadcastAttempts: 1 }), true);

  // A chained consolidation step (kind transfer, no journaled recipient) is a
  // self-transfer with a zero protocol delta — "Preparing balance…", no amount.
  const consolidation = {
    kind: 'transfer',
    status: 'broadcast',
    broadcastAttempts: 1,
    amountStroops: '750000000',
  };
  assert.equal(isInternalPendingAction(consolidation), true);
  assert.equal(
    isInternalPendingAction({ ...consolidation, recipientFingerprint: 'AAAA BBBB' }),
    false,
  );
  assert.equal(privateBalancePendingLine([consolidation], 7, 'XLM'), 'Preparing balance…');
  // The final send of a chain still shows its real outgoing amount.
  assert.equal(
    privateBalancePendingLine([
      consolidation,
      { kind: 'transfer', status: 'broadcast', broadcastAttempts: 1, amountStroops: '250000000', recipientFingerprint: 'AAAA BBBB' },
    ], 7, 'XLM'),
    '− 25 XLM confirming…',
  );

  // Privacy mode masks the amount, exactly like the balance above the line.
  assert.equal(
    privateBalancePendingLine(
      [{ kind: 'transfer', status: 'broadcast', broadcastAttempts: 1, amountStroops: '250000000', recipientFingerprint: 'AAAA BBBB' }],
      7,
      'XLM',
      { privacyMode: true },
    ),
    '− •••••• confirming…',
  );
  assert.equal(
    privateBalancePendingLine(
      [{ kind: 'deposit', status: 'signed', broadcastAttempts: 0, amountStroops: '100000000' }],
      7,
      'XLM',
      { privacyMode: true },
    ),
    '+ •••••• confirming…',
  );
});

test('the review balance simulation stays protocol-true before and after inputs reserve', async () => {
  const { privateReviewBalanceSimulation } = await import(
    '../src/features/private-balance/components/PrivateReviewSimulation.ts'
  );

  // Notes 40 + 35 XLM, sending 30 (selects the 40-note, change 10).
  // While preparing, nothing is reserved yet: before 75, after 45.
  assert.deepEqual(
    privateReviewBalanceSimulation({
      kind: 'transfer',
      liveUnspentStroops: 750000000n,
      amountStroops: 300000000n,
      review: null,
    }),
    { beforeStroops: 750000000n, afterStroops: 450000000n },
  );
  // Once the prepared review lands, the 40-note is reserved and the live
  // unspent balance already dropped to 35 — the panel must still read 75 → 45
  // (change returns to the balance; the fee is paid publicly).
  assert.deepEqual(
    privateReviewBalanceSimulation({
      kind: 'transfer',
      liveUnspentStroops: 350000000n,
      amountStroops: 300000000n,
      review: { kind: 'transfer', amountStroops: '300000000', changeValueStroops: '100000000' },
    }),
    { beforeStroops: 750000000n, afterStroops: 450000000n },
  );
  // Withdrawals reserve identically.
  assert.deepEqual(
    privateReviewBalanceSimulation({
      kind: 'withdraw',
      liveUnspentStroops: 350000000n,
      amountStroops: 300000000n,
      review: { kind: 'withdraw', amountStroops: '300000000', changeValueStroops: '100000000' },
    }),
    { beforeStroops: 750000000n, afterStroops: 450000000n },
  );
  // Deposits reserve no notes — no adjustment in either state.
  assert.deepEqual(
    privateReviewBalanceSimulation({
      kind: 'deposit',
      liveUnspentStroops: 750000000n,
      amountStroops: 100000000n,
      review: { kind: 'deposit', amountStroops: '100000000', changeValueStroops: '0' },
    }),
    { beforeStroops: 750000000n, afterStroops: 850000000n },
  );
});

test('private spend review discloses its atomic idle-pool refresh', () => {
  const review = read('src/features/private-balance/components/PrivateActionReview.tsx');

  assert.match(review, /review\?\.transaction\.refreshesAnchor/);
  assert.match(review, /Private access/);
  assert.match(review, /Refreshed with this payment/);
});

test('private assets coexist with wallet home and open one focused detail modal', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  assert.equal(
    existsSync(new URL('../src/features/private-balance/components/PrivateBalanceAssetRow.tsx', import.meta.url)),
    true,
    'the private balance should appear as a row in Your Assets',
  );
  const row = read('src/features/private-balance/components/PrivateBalanceAssetRow.tsx');
  const details = read('src/features/private-balance/components/PrivateAssetDetailModalBody.tsx');

  const viewUnion = dashboard.slice(dashboard.indexOf('type View ='), dashboard.indexOf('const MERCHANT_VIEWS'));
  assert.doesNotMatch(viewUnion, /\| "private"/);
  assert.doesNotMatch(dashboard, /PrivatePaymentsPage/);
  assert.match(dashboard, /PrivateBalanceAssetRow/);
  assert.match(dashboard, /privateAssetOpen/);
  assert.match(dashboard, /<PrivateAssetDetailModal/);
  assert.doesNotMatch(dashboard, /<PrivateBalanceCard privacyMode=\{privacyMode\}/);
  assert.doesNotMatch(dashboard, /switchTab\("private"\)/);
  assert.match(row, /privacyMode/);
  assert.match(row, /onOpen/);
  assert.match(row, /assetCode/);
  assert.match(row, /formatPrivateBalanceAmount/);
  assert.doesNotMatch(row, />\s*Private\s*</);
  assert.match(details, /balance-display/);
  assert.match(details, /panel-inset/);
  assert.match(details, /Last checked/);
  assert.match(details, /lastVerifiedLedger/);
  assert.doesNotMatch(details, /label="Send"|label="Receive"|label="Withdraw"|label="Add"/);
});

test('private asset details keep refresh, recovery, and advanced privacy reachable', () => {
  const detail = read('src/features/private-balance/components/PrivateAssetDetailModalBody.tsx');
  assert.match(detail, /PrivatePaymentsDetails/);
  assert.match(detail, /Private Payments settings/);
});

test('reusable XLM receipts move into the private balance inside the existing asset sheet', () => {
  const details = read('src/features/private-balance/components/PrivateAssetDetailModalBody.tsx');
  const receipts = read('src/features/private-balance/components/StealthReceipts.tsx');

  assert.match(details, /entry\.asset\.kind === 'native'/);
  assert.match(details, /<StealthReceipts/);
  assert.match(receipts, /stealthPayments/);
  assert.match(receipts, /prepareStealthSweep/);
  assert.match(receipts, /submitStealthSweep/);
  assert.match(receipts, /Move to Private Balance/);
  assert.match(receipts, /One-time account/);
  assert.match(receipts, /Maximum network fee/);
  assert.match(receipts, /cancelAction/);
  assert.doesNotMatch(receipts, /<Modal\b/);
});

test('private asset rows stay concise and testnet value help works on touch', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  const row = read('src/features/private-balance/components/PrivateBalanceAssetRow.tsx');
  const details = read('src/features/private-balance/components/PrivateAssetDetailModalBody.tsx');

  assert.doesNotMatch(row, /Checked through ledger/);
  assert.match(row, /Ready/);
  assert.match(row, /<AssetAvatar[\s\S]{0,500}?privatePayment/);
  assert.doesNotMatch(row, /className="absolute bottom-0 right-0/);
  assert.match(details, /Checked through ledger/);
  assert.match(dashboard, /aria-label="About testnet private asset values"/);
  assert.match(dashboard, /setPrivateValueInfoOpen\(true\)/);
  assert.match(dashboard, /Representative pricing only/);
});

test('the account total includes configured private asset value in active and all views', () => {
  const dashboard = read('src/components/Dashboard.tsx');

  assert.match(dashboard, /portfolioUsdWithPrivateAssets/);
  assert.match(
    dashboard,
    /portfolioUsdWithPrivateAssets\(\s*activeRepresentativePublicUsd,\s*privateRepresentativeUsd,?\s*\)/,
  );
  assert.match(
    dashboard,
    /portfolioUsdWithPrivateAssets\(\s*allRepresentativePublicUsd,\s*privateRepresentativeUsd,?\s*\)/,
  );
  assert.match(dashboard, /Total account/);
});

test('the XLM balance and active sidebar account include cached private XLM', () => {
  const dashboard = read('src/components/Dashboard.tsx');

  assert.match(dashboard, /portfolioXlmWithPrivateAssets/);
  assert.match(dashboard, /const activeAccountXlm = portfolioXlmWithPrivateAssets/);
  assert.match(dashboard, /const allAccountsXlm = portfolioXlmWithPrivateAssets/);
  assert.match(dashboard, /isActive\s*\? activeAccountXlm/);
  assert.match(dashboard, /isActive && activeAccountTotalUsd !== null/);
  assert.match(dashboard, /fmtFiat\(activeAccountTotalUsd, fiatCurrency, fiatRates\)/);
  assert.match(dashboard, />\s*Balance\s*</);
  assert.doesNotMatch(dashboard, /Public XLM balance|Public XLM across all accounts/);
});

test('home keeps wallet consent separate from each private asset readiness state', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  const row = read('src/features/private-balance/components/PrivateBalanceAssetRow.tsx');

  assert.match(dashboard, /usePrivateBalancePortfolio\(\)/);
  assert.match(dashboard, /Your Private Assets/);
  assert.match(dashboard, /privateAvailableAssets\.map/);
  assert.match(dashboard, /privatePortfolioEntries\.find/);
  assert.match(dashboard, /selectPrivateAsset\(option\.deploymentId\)/);
  assert.match(dashboard, /option=\{option\}/);
  assert.match(dashboard, /entry=\{entry \?\? null\}/);
  assert.match(dashboard, /privatePaymentsEnabled\(privateAvailableAssets\)/);
  assert.match(dashboard, /paymentsEnabled=\{privatePaymentsAreEnabled\}/);
  assert.match(dashboard, /prepared=\{option\.encryptedStateExists && entry !== undefined\}/);
  assert.doesNotMatch(
    dashboard,
    /verifiedBalanceAtomicUnits:\s*["']0["'][\s\S]{0,160}?lastVerifiedLedger:\s*null/,
  );
  assert.doesNotMatch(dashboard, /asset\.isNative && \(privateBalanceAvailable \|\| showPrivatePayments\)/);
  assert.match(row, /option:\s*PrivateBalanceAssetOption/);
  assert.match(row, /entry:\s*PrivatePortfolioEntry \| null/);
  assert.match(row, /paymentsEnabled:\s*boolean/);
  assert.match(row, /prepared:\s*boolean/);
  assert.match(row, /prepared && entry/);
  assert.match(row, /Available/);
  assert.match(row, /Add Funds/);
  assert.match(row, /Not enabled/);
  assert.match(row, /Turn on/);
});

test('development keeps the private-assets section visible during bootstrap', () => {
  const dashboard = read('src/components/Dashboard.tsx');

  assert.match(
    dashboard,
    /\(privateBalanceAvailable \|\| privateAvailableAssets\.length > 0 \|\| privatePortfolioEntries\.length > 0\)/,
  );
  assert.match(dashboard, /Checking private assets/);
});

test('a wallet without consent opens setup while an available sibling opens private Add', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  const setup = read('src/features/private-balance/components/PrivateBalanceSetupBody.tsx');

  assert.match(dashboard, /const PrivateBalanceSetup = dynamic\(/);
  assert.match(dashboard, /privateSetupOpen/);
  assert.match(dashboard, /if \(!privatePaymentsAreEnabled\)/);
  assert.match(dashboard, /setPrivateSetupOpen\(true\)/);
  assert.match(dashboard, /if \(!option\.encryptedStateExists \|\| entry === undefined\)/);
  assert.match(dashboard, /setAddAssetInitialMode\("private"\)/);
  assert.match(dashboard, /initialMode=\{addAssetInitialMode\}/);
  assert.match(
    dashboard,
    /\{privateSetupMounted && \([\s\S]{0,120}?<PrivateBalanceSetup[\s\S]{0,120}?open=\{privateSetupOpen\}[\s\S]{0,120}?setPrivateSetupOpen\(false\)/,
  );
  assert.match(setup, /usePrivateBalanceRuntime\(\)/);
  assert.match(setup, /availableAssets/);
  assert.match(setup, /Private Payments ready/);
  assert.match(setup, /SETUP_COMPLETION_HOLD_MS/);
  assert.match(setup, /onCloseRef\.current\(\)/);
});

test('asset section headers contain no add-asset links and private details identify the selected asset', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  const details = read('src/features/private-balance/components/PrivateAssetDetailModalBody.tsx');

  const publicHeader = dashboard.slice(
    dashboard.indexOf('Your Assets'),
    dashboard.indexOf('Your Private Assets'),
  );
  const privateHeader = dashboard.slice(
    dashboard.indexOf('Your Private Assets'),
    dashboard.indexOf('Right Column: Live Chart'),
  );
  assert.doesNotMatch(publicHeader, /\+ Add Asset/);
  assert.doesNotMatch(privateHeader, /\+ Add Asset|Add XLM privately/);
  assert.match(dashboard, /entry=\{privateAssetEntry\}/);
  // The asset step names the asset; the settings steps share the same header.
  assert.match(details, /title: entry\.asset\.code, subtitle: 'Private balance'/);
  assert.match(details, /PRIVATE_SETTINGS_STEP_HEADER\[step\]/);
  assert.doesNotMatch(dashboard, /showAssetSelector=\{false\}/);
});

test('wallet activity merges cached private actions and labels their provenance', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  const details = read('src/components/TxDetailModalBody.tsx');
  const notch = read('src/components/PrivateShieldNotch.tsx');
  assert.match(dashboard, /privatePortfolioActivityItems/);
  assert.match(dashboard, /mergedActivity/);
  assert.match(dashboard, /item\.private/);
  // Provenance is marked by the shield notch on the leading direction circle
  // (with a "Private payment" tooltip), not a text pill.
  assert.match(dashboard, /item\.private && <PrivateShieldNotch/);
  assert.doesNotMatch(dashboard, /title=\{item\.private \? "Private payment" : undefined\}/);
  assert.doesNotMatch(dashboard, /group\/private(?:\s|"|:)/);
  assert.doesNotMatch(dashboard, />\s*Private\s*</);
  assert.match(notch, /role="tooltip"/);
  assert.match(notch, /group\/private-notch/);
  assert.match(notch, /group-hover\/private-notch:block/);
  assert.match(notch, /bottom-full left-0/);
  assert.doesNotMatch(notch, /-translate-x-1\/2/);
  assert.doesNotMatch(notch, /group-(?:hover|focus-visible)\/private:/);
  assert.match(notch, /label = "Private payment"/);
  assert.match(notch, /className="sr-only">\{label\}/);
  assert.doesNotMatch(notch, /<button/);
  assert.match(details, /item\.private/);
  assert.match(details, /Verified locally/);
  assert.match(details, /Private action/);
  assert.match(details, /Private memo/);
  assert.match(details, /item\.private\?\.memoHex/);
  assert.match(details, /decodePrivateMemoHex/);
});

test('public private-balance boundary actions expose only real explorer transactions', () => {
  const walletDetails = read('src/components/TxDetailModalBody.tsx');
  const privateDetails = read('src/features/private-balance/components/PrivateActivityDetails.tsx');

  assert.match(
    walletDetails,
    /privateBalanceExplorerTxHash\(item\.private\.actionKind, item\.hash\)/,
  );
  assert.match(walletDetails, /privateExplorerHash[\s\S]*?explorerTxUrl\(privateExplorerHash\)/);
  assert.match(
    privateDetails,
    /privateBalanceExplorerTxHash\([\s\S]*?transactionHash/,
  );
  assert.match(
    privateDetails,
    /explorerTxUrl\(explorerTransactionHash\)/,
  );
});

test('private runtime publishes through one stable data provider', () => {
  const boundary = read('src/components/PrivateBalanceRuntimeBoundary.tsx');

  assert.match(boundary, /PrivateBalanceRuntimePublisher/);
  assert.match(boundary, /publishedRuntime/);
  assert.match(boundary, /PrivateBalanceRuntimeDataProvider/);
});

test('incoming private payments surface as one toast with sound inside the runtime mount', () => {
  const boundary = read('src/components/PrivateBalanceRuntimeBoundary.tsx');
  const toasts = read('src/features/private-balance/components/PrivateIncomingToasts.tsx');

  assert.match(boundary, /PrivateIncomingToasts/);
  assert.doesNotMatch(boundary, /\buseWallet\(\)/);
  assert.match(toasts, /onIncomingPrivatePayment/);
  assert.match(toasts, /useToast/);
  assert.match(toasts, /playReceiveSound\(\)/);
  assert.match(toasts, /privacyMode/);
  assert.match(toasts, /Received a private payment/);
  assert.match(toasts, /privately/);
  // One feedback per event: the chime plays, so the toast stays silent.
  assert.match(toasts, /toast\(message, 'success', \{ silent: true \}\)/);
});

test('private payments select and label the verified asset without eager note optimization', () => {
  const selector = read('src/features/private-balance/components/PrivateAssetSelector.tsx');
  const card = read('src/features/private-balance/components/PrivateBalanceCard.tsx');
  const activity = read('src/features/private-balance/components/PrivateActivity.tsx');
  const receive = read('src/features/private-balance/components/ReceivePrivate.tsx');
  const setup = read('src/features/private-balance/components/PrivateBalanceSetupBody.tsx');

  assert.match(selector, /availableAssets/);
  assert.match(selector, /selectedDeploymentId/);
  assert.match(selector, /selectAsset/);
  assert.match(selector, /usePrivateBalancePortfolio/);
  assert.match(selector, /<Select/);
  assert.match(selector, /Balance:/);
  assert.doesNotMatch(selector, /<Modal/);
  assert.doesNotMatch(selector, /Private asset/);
  assert.doesNotMatch(selector, /\bpool\b/i);
  assert.match(card, /PrivateAssetSelector/);
  assert.match(card, /asset\?\.code/);
  assert.match(activity, /asset\?\.code/);
  assert.match(receive, /asset\?\.code/);
  // Setup labels the whole verified asset list (option.asset.code) since the
  // multi-asset refactor.
  assert.match(setup, /asset\.code/);
});

test('private action tabs share asset selection and one wallet-wide access gate', () => {
  const send = read('src/features/private-balance/components/SendPrivate.tsx');
  const gateUrl = new URL(
    '../src/features/private-balance/components/PrivatePaymentAccessGate.tsx',
    import.meta.url,
  );
  assert.equal(existsSync(gateUrl), true, 'private action access gate should exist');
  const setup = read('src/features/private-balance/components/PrivateSetupContent.tsx');
  const gate = read('src/features/private-balance/components/PrivatePaymentAccessGate.tsx');

  assert.match(send, /modeControl\?: ReactNode/);
  assert.match(send, /\{modeControl\}/);
  assert.match(send, /PrivateAssetSelector/);
  assert.match(setup, /Turn On Private Payments/);
  assert.doesNotMatch(setup, /Set up private/);
  assert.match(setup, /action/);
  assert.match(gate, /privatePaymentsEnabled/);
  assert.match(gate, /privatePaymentAccessState/);
  assert.match(gate, /Preparing private/);
  assert.match(gate, /void optIn\(\)/);
  assert.match(gate, /<PrivateBalanceSetup[\s\S]{0,160}?open=\{setupOpen\}/);
  assert.match(gate, /setSetupOpen\(false\)/);
  assert.match(setup, /onTurnOn/);
  assert.doesNotMatch(setup, /<PrivateBalanceSetup/);
});

test('private payment browser helpers open the current destination', () => {
  const helpers = read('e2e/private-balance/helpers.ts');

  assert.match(helpers, /Your Private Assets/);
  assert.match(helpers, /Open private XLM/);
  assert.doesNotMatch(helpers, /Open Private Payments/);
  assert.doesNotMatch(helpers, /Review an optional, separate private XLM balance/);
});
