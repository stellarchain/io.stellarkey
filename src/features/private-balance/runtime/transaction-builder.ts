import { Address, Contract, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { PrivateBalanceManifest } from '../../../lib/private-balance-manifest';

export interface ContractProof {
  a: Uint8Array;
  b: Uint8Array;
  c: Uint8Array;
}

export interface ContractOutputPackage {
  commitment: Uint8Array;
  recipientEnvelope: Uint8Array;
}

interface CommonContractAction {
  assetContractId: string;
  actionNonce: Uint8Array;
  anchorRoot: Uint8Array;
  nullifiers: [Uint8Array, Uint8Array];
  outputs: [ContractOutputPackage, ContractOutputPackage];
  publicValue: bigint;
}

export interface DepositContractAction extends CommonContractAction {
  depositSource: string;
}

export interface TransferContractAction extends CommonContractAction {
  relayerFee: bigint;
  relayer: string;
}

export interface WithdrawContractAction extends CommonContractAction {
  publicRecipient: string;
  relayerFee: bigint;
  relayer: string;
}

function requireLength(name: string, bytes: Uint8Array, expected: number): void {
  if (bytes.length !== expected) throw new Error(`${name} must be ${expected} bytes`);
}

function scMap(entries: ReadonlyArray<readonly [string, xdr.ScVal]>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    [...entries]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: value })),
  );
}

function encodeProof(proof: ContractProof): xdr.ScVal {
  requireLength('Proof A', proof.a, 64);
  requireLength('Proof B', proof.b, 128);
  requireLength('Proof C', proof.c, 64);
  return scMap([
    ['a', xdr.ScVal.scvBytes(proof.a)],
    ['b', xdr.ScVal.scvBytes(proof.b)],
    ['c', xdr.ScVal.scvBytes(proof.c)],
  ]);
}

function encodeOutput(output: ContractOutputPackage, index: number): xdr.ScVal {
  requireLength(`Output ${index} commitment`, output.commitment, 32);
  requireLength(`Output ${index} recipient envelope`, output.recipientEnvelope, 181);
  return scMap([
    ['commitment', xdr.ScVal.scvBytes(output.commitment)],
    ['recipient_envelope', xdr.ScVal.scvBytes(output.recipientEnvelope)],
  ]);
}

function relayerEntries(
  action: Pick<TransferContractAction, 'relayerFee' | 'relayer'>,
): Array<readonly [string, xdr.ScVal]> {
  if (action.relayerFee < 0n || action.relayerFee > (1n << 63n) - 1n) {
    throw new Error('Relayer fee must fit the protocol amount range');
  }
  return [
    ['relayer_fee', nativeToScVal(action.relayerFee)],
    ['relayer', Address.fromString(action.relayer).toScVal()],
  ];
}

function commonActionEntries(action: CommonContractAction): Array<readonly [string, xdr.ScVal]> {
  requireLength('Action nonce', action.actionNonce, 32);
  requireLength('Anchor root', action.anchorRoot, 32);
  requireLength('Nullifier 0', action.nullifiers[0], 32);
  requireLength('Nullifier 1', action.nullifiers[1], 32);
  if (action.publicValue < 0n || action.publicValue > (1n << 63n) - 1n) {
    throw new Error('Public value must fit the protocol amount range');
  }
  return [
    ['action_nonce', xdr.ScVal.scvBytes(action.actionNonce)],
    ['asset', Address.fromString(action.assetContractId).toScVal()],
    ['anchor_root', xdr.ScVal.scvBytes(action.anchorRoot)],
    ['nullifier_0', xdr.ScVal.scvBytes(action.nullifiers[0])],
    ['nullifier_1', xdr.ScVal.scvBytes(action.nullifiers[1])],
    ['output_0', encodeOutput(action.outputs[0], 0)],
    ['output_1', encodeOutput(action.outputs[1], 1)],
    ['public_value', nativeToScVal(action.publicValue)],
  ];
}

export class PrivateBalanceTransactionBuilder {
  private readonly contract: Contract;

  constructor(manifest: Pick<PrivateBalanceManifest, 'poolContractId'>) {
    this.contract = new Contract(manifest.poolContractId);
  }

  public buildDepositOperation(params: {
    action: DepositContractAction;
    proof: ContractProof;
  }): xdr.Operation {
    const action = scMap([
      ...commonActionEntries(params.action),
      ['deposit_source', Address.fromString(params.action.depositSource).toScVal()],
    ]);
    return this.contract.call('deposit', action, encodeProof(params.proof));
  }

  public buildTransferOperation(params: {
    action: TransferContractAction;
    proof: ContractProof;
  }): xdr.Operation {
    return this.contract.call(
      'transfer',
      scMap([...commonActionEntries(params.action), ...relayerEntries(params.action)]),
      encodeProof(params.proof),
    );
  }

  public buildWithdrawOperation(params: {
    action: WithdrawContractAction;
    proof: ContractProof;
  }): xdr.Operation {
    const action = scMap([
      ...commonActionEntries(params.action),
      ['public_recipient', Address.fromString(params.action.publicRecipient).toScVal()],
      ...relayerEntries(params.action),
    ]);
    return this.contract.call('withdraw', action, encodeProof(params.proof));
  }

}
