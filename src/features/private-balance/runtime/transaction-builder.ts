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
  outgoingEnvelope: Uint8Array;
}

export interface ContractAction {
  actionNonce: Uint8Array;
  anchorRoot: Uint8Array;
  nullifiers: [Uint8Array, Uint8Array];
  outputs: [ContractOutputPackage, ContractOutputPackage, ContractOutputPackage];
  publicInflow: bigint;
  publicOutflow: bigint;
  appends: boolean;
  assetIndex?: number;
  depositSource?: string;
  publicRecipient?: string;
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
  requireLength(`Output ${index} outgoing envelope`, output.outgoingEnvelope, 157);
  return scMap([
    ['commitment', xdr.ScVal.scvBytes(output.commitment)],
    ['outgoing_envelope', xdr.ScVal.scvBytes(output.outgoingEnvelope)],
    ['recipient_envelope', xdr.ScVal.scvBytes(output.recipientEnvelope)],
  ]);
}

function optionalAddress(address: string | undefined): xdr.ScVal {
  if (address === undefined) return xdr.ScVal.scvVoid();
  return Address.fromString(address).toScVal();
}

function encodeAction(action: ContractAction): xdr.ScVal {
  requireLength('Action nonce', action.actionNonce, 32);
  requireLength('Anchor root', action.anchorRoot, 32);
  requireLength('Nullifier 0', action.nullifiers[0], 32);
  requireLength('Nullifier 1', action.nullifiers[1], 32);
  for (const [name, value] of [
    ['Public inflow', action.publicInflow],
    ['Public outflow', action.publicOutflow],
  ] as const) {
    if (value < 0n || value > (1n << 63n) - 1n) {
      throw new Error(`${name} must fit the protocol amount range`);
    }
  }
  if (action.publicInflow > 0n && action.publicOutflow > 0n) {
    throw new Error('At most one settlement leg may carry value');
  }
  if (!action.appends && action.publicOutflow === 0n) {
    throw new Error('Non-appending actions must settle value');
  }
  return scMap([
    ['action_nonce', xdr.ScVal.scvBytes(action.actionNonce)],
    ['anchor_root', xdr.ScVal.scvBytes(action.anchorRoot)],
    ['nullifier_0', xdr.ScVal.scvBytes(action.nullifiers[0])],
    ['nullifier_1', xdr.ScVal.scvBytes(action.nullifiers[1])],
    ['output_0', encodeOutput(action.outputs[0], 0)],
    ['output_1', encodeOutput(action.outputs[1], 1)],
    ['output_2', encodeOutput(action.outputs[2], 2)],
    ['public_inflow', nativeToScVal(action.publicInflow)],
    ['public_outflow', nativeToScVal(action.publicOutflow)],
    ['appends', nativeToScVal(action.appends)],
    [
      'asset_index',
      action.assetIndex === undefined
        ? xdr.ScVal.scvVoid()
        : nativeToScVal(action.assetIndex, { type: 'u32' }),
    ],
    ['deposit_source', optionalAddress(action.depositSource)],
    ['public_recipient', optionalAddress(action.publicRecipient)],
  ]);
}

export class PrivateBalanceTransactionBuilder {
  private readonly contract: Contract;

  constructor(manifest: Pick<PrivateBalanceManifest, 'poolContractId'>) {
    this.contract = new Contract(manifest.poolContractId);
  }

  public buildTouchRootOperation(): xdr.Operation {
    return this.contract.call('touch_root');
  }

  /// Protocol V2.1 (wire version 3) exposes one shielded-action entrypoint; the settlement legs
  /// inside the action decide whether it deposits, transfers, or withdraws.
  public buildActionOperation(params: {
    action: ContractAction;
    proof: ContractProof;
  }): xdr.Operation {
    return this.contract.call('action', encodeAction(params.action), encodeProof(params.proof));
  }
}
